"""Replay the demo flows in a headless browser and save screenshots.

Usage: python tools/replay.py [output_dir] [flow ...]
Needs Python Playwright and a Chrome/Chromium install.
Flows click the same buttons a user would; no API key is used (demo mode).
"""
import os
import pathlib
import sys

from playwright.sync_api import sync_playwright


def launch_args():
    """Use CHROME_PATH if set, otherwise Playwright's own Chromium."""
    path = os.environ.get("CHROME_PATH")
    return {"executable_path": path, "args": ["--no-sandbox"]} if path else {}

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / "index.html").as_uri() + "?fast=1&demo=1"

# Each step: ("case", id) | ("chip", label) | ("click", css) | ("select", css, value) | ("shot", name)
FLOWS = {
    "A": [("shot", "A0-start"), ("case", "A"), ("shot", "A1-question"), ("chip", "No"), ("shot", "A2-result"),
          ("click", "button[data-panel=whatif]"), ("shot", "A3-whatif")],
    "B": [("case", "B"), ("shot", "B1-result"), ("select", "#format", "unified"), ("shot", "B2-unified")],
    "C": [("case", "C"), ("chip", "No"), ("shot", "C1-result"), ("click", "button[data-panel=edit]"),
          ("select", "select[data-fact=duration_days]", "3"), ("shot", "C2-corrected")],
}


def run(out, names):
    out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_args())
        page = browser.new_page(viewport={"width": 520, "height": 900}, device_scale_factor=2)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        for name in names:
            page.goto(URL)
            for step in FLOWS[name]:
                kind = step[0]
                if kind == "case":
                    page.click(f'button[data-case="{step[1]}"]')
                elif kind == "chip":
                    page.locator(".chips").last.get_by_role("button", name=step[1], exact=True).click()
                elif kind == "click":
                    page.locator(step[1]).last.click()
                elif kind == "select":
                    page.locator(step[1]).last.select_option(step[2])
                elif kind == "shot":
                    page.wait_for_timeout(150)
                    page.screenshot(path=str(out / f"{step[1]}.png"), full_page=True)
                    print("saved", step[1])
        browser.close()
        if errors:
            print("PAGE ERRORS:", errors)
            sys.exit(1)


if __name__ == "__main__":
    out_dir = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "screenshots"
    run(out_dir, sys.argv[2:] or list(FLOWS))
