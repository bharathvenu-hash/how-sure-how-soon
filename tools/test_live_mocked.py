"""Test live (LLM) mode with mocked provider responses.

No real API is called: Playwright intercepts the request, checks its shape
and returns a canned reply in that provider's format. This checks the
adapter plumbing, not the quality of any real model.
Usage: python tools/test_live_mocked.py
"""
import json
import os
import pathlib
import sys

from playwright.sync_api import sync_playwright


def launch_args():
    """Use CHROME_PATH if set, otherwise Playwright's own Chromium."""
    path = os.environ.get("CHROME_PATH")
    return {"executable_path": path, "args": ["--no-sandbox"]} if path else {}

URL = (pathlib.Path(__file__).resolve().parent.parent / "index.html").as_uri() + "?fast=1&demo=1"

# What the "model" says. Case 2 deliberately misses the breathing problem.
REPLIES = {
    "sore": {"symptom": "sore_throat", "facts": {"duration_days": 2, "fever": False}, "confidence": 0.9,
             "reply": "Thanks, a sore throat for two days without a fever."},
    "miss": {"symptom": "chest", "facts": {}, "confidence": 0.4, "reply": "Thanks for telling me about your chest."},
}


CARE = {"safe": {"text": "A sore throat can feel miserable, but it usually settles within a week."},
        "unsafe": {"text": "Don't worry, you probably have tonsillitis. Take 500 mg of paracetamol."}}


def wrap(provider, obj):
    text = json.dumps(obj)
    if provider == "gemini":
        return {"candidates": [{"content": {"parts": [{"text": text}]}}]}
    if provider == "openai":
        return {"choices": [{"message": {"content": text}}]}
    return {"content": [{"type": "text", "text": "```json\n" + text + "\n```"}]}


def run():
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_args())
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        seen = {}

        def handler(provider, reply_key, status=200, care="safe"):
            def h(route, request):
                body = json.loads(request.post_data)
                if "voice of SureSoon" in request.post_data:
                    return route.fulfill(status=200, content_type="application/json",
                                         body=json.dumps(wrap(provider, CARE[care])),
                                         headers={"Access-Control-Allow-Origin": "*"})
                seen[provider] = {"headers": request.headers, "body": body}
                if status != 200:
                    return route.fulfill(status=status, content_type="application/json",
                                         body=json.dumps({"error": {"message": "invalid key"}}))
                route.fulfill(status=200, content_type="application/json",
                              body=json.dumps(wrap(provider, REPLIES[reply_key])),
                              headers={"Access-Control-Allow-Origin": "*"})
            return h

        def setup(provider):
            page.goto(URL)
            page.click("#settings summary")
            page.select_option("#mode", "live")
            page.select_option("#provider", provider)
            page.fill("#key", "test-key-not-real")
            page.click("#applySettings")

        hosts = {"gemini": "**/generativelanguage.googleapis.com/**", "openai": "**/api.openai.com/**",
                 "anthropic": "**/api.anthropic.com/**"}

        # 1. Each provider: request shape and parsing.
        for prov, pattern in hosts.items():
            page.unroute("**/*")
            page.route(pattern, handler(prov, "sore"))
            setup(prov)
            page.fill("#input", "I have had a sore throat for 2 days, no fever")
            page.click("#send")
            page.wait_for_selector(".chips button")
            text = page.inner_text("#chat")
            ok = "two days without a fever" in text and "unable to swallow" in text
            h = seen.get(prov, {}).get("headers", {})
            key_ok = ("test-key-not-real" in (h.get("x-goog-api-key", "") + h.get("authorization", "") + h.get("x-api-key", "")))
            print(prov, "reply shown and next question asked:", ok, "| key sent only in header:", key_ok,
                  "| badge:", page.inner_text("#modeBadge"))
            if not (ok and key_ok):
                failures.append(prov)

        # 1b. LLM reassurance: safe text is shown (tagged AI); unsafe text is replaced by the template.
        for care, expect_ai in (("safe", True), ("unsafe", False)):
            page.unroute("**/*")
            page.route(hosts["gemini"], handler("gemini", "sore", care=care))
            setup("gemini")
            page.fill("#input", "I have had a sore throat for 2 days, no fever")
            page.click("#send")
            page.wait_for_selector(".chips button")
            page.locator(".chips").last.get_by_role("button", name="No", exact=True).click()
            page.wait_for_selector(".result")
            opening = page.inner_text(".care-open")
            shown_ai = "usually settles within a week" in opening
            leaked = "tonsillitis" in page.inner_text("#chat") or "500 mg" in page.inner_text("#chat")
            ok = (shown_ai == expect_ai) and not leaked
            print("LLM reassurance (" + care + "):", "shown" if shown_ai else "replaced by template", "| unsafe text leaked:", leaked)
            if not ok:
                failures.append("care-" + care)

        # 2. Model misses a red flag: the raw-text rule must still catch it.
        page.unroute("**/*")
        page.route(hosts["gemini"], handler("gemini", "miss"))
        setup("gemini")
        page.fill("#input", "my chest feels heavy and I can't breathe properly")
        page.click("#send")
        page.wait_for_selector(".result")
        res = page.inner_text(".result")
        ok = "Call 999 now" in res
        print("LLM missed breathing problem, rules still show Call 999:", ok)
        if not ok:
            failures.append("redflag")

        # 3. Provider error: fall back to the simulated extractor.
        page.unroute("**/*")
        page.route(hosts["openai"], handler("openai", "sore", status=401))
        setup("openai")
        page.fill("#input", "I have had a sore throat for 2 days, no fever")
        page.click("#send")
        page.wait_for_selector(".chips button")
        text = page.inner_text("#chat")
        ok = "could not be reached" in text and "unable to swallow" in text
        print("Provider error falls back to simulated extractor:", ok)
        if not ok:
            failures.append("fallback")

        browser.close()
        if errors:
            print("PAGE ERRORS:", errors)
            failures.append("pageerror")
    print("FAILED:" if failures else "ALL PASSED", failures or "")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    run()
