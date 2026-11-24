"""Browser tests for conversation behaviour (demo mode, no key).

Covers cases found by trying the prototype: greetings, typed answers and
answers the system cannot read. Usage: python tools/test_ui.py
"""
import os
import pathlib
import sys

from playwright.sync_api import sync_playwright

URL = (pathlib.Path(__file__).resolve().parent.parent / "index.html").as_uri() + "?fast=1&demo=1"


def launch_args():
    path = os.environ.get("CHROME_PATH")
    return {"executable_path": path, "args": ["--no-sandbox"]} if path else {}


def main():
    failures = []

    def check(name, ok):
        print(("  ok  " if ok else "  FAIL ") + name)
        if not ok:
            failures.append(name)

    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_args())
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        def say(text):
            page.fill("#input", text)
            page.press("#input", "Enter")
            page.wait_for_timeout(60)

        def chat():
            return page.inner_text("#chat")

        # 1. Greetings do not start a triage
        page.goto(URL)
        for t in ["i", "hello", "hi"]:
            say(t)
        check("greetings get a friendly reply", "What's bothering you today?" in chat() and "Hello, and good" in chat())
        check("greetings show symptom examples plus Something else", page.locator(".symptom-chips button").count() == 5)
        check("greetings never produce a result", page.locator(".result").count() == 0)
        page.locator(".symptom-chips button", has_text="Sore throat").click()
        page.wait_for_selector(".chips button")
        check("symptom button starts the questions", "Sorry to hear about your sore throat" in chat())

        # 0. Visitors do not see the demo case buttons (only the scripts use ?demo)
        page.goto(URL.replace("&demo=1", ""))
        check("no demo cases for visitors", page.locator("button[data-case]").count() == 0)

        # 1a. Examples are ordered by UK data, sourced, and "Something else" returns to free text
        page.goto(URL)
        labels = page.locator(".starter button").all_inner_texts()
        check("examples in UK-data order with Something else", labels == ["Headache", "Cough", "Sore throat", "Chest discomfort", "Something else"])
        check("source shown for the order", "El-Osta et al., 2025" in page.inner_text(".welcome"))
        page.locator(".starter button", has_text="Something else").click()
        check("Something else focuses the message box", page.evaluate("document.activeElement.id") == "input"
              and page.locator(".progress").count() == 0)

        # 1b. Any non-health message, however it is written, does not start a triage
        for t in ["HELLO Good Morning", "what's the weather like?", "??", "Good evening SureSoon!!"]:
            page.goto(URL)
            say(t)
            check("no triage for: " + t, page.locator(".progress").count() == 0 and page.locator(".result").count() == 0
                  and "What's bothering you today?" in chat())

        # 1d. Friendly replies and a polite scope line for off-topic questions
        for t, expect in [("Good morning!", "Good morning! I'm SureSoon"), ("how are you?", "how are you feeling?"),
                          ("who won the football last night?", "can't talk about sport"),
                          ("recommend a good movie", "can't talk about films, TV or music"),
                          ("thanks", "You're welcome"), ("what can you do?", "I can't diagnose"),
                          ("my name is bharath", "Nice to meet you, Bharath!")]:
            page.goto(URL)
            say(t)
            check("friendly reply to: " + t, expect in chat() and page.locator(".progress").count() == 0)

        # 1f. The name is used once a symptom is described
        page.goto(URL)
        say("my name is bharath")
        say("I have a sore throat")
        check("name used in the symptom acknowledgement", "Sorry to hear about your sore throat, Bharath." in chat())

        # 1c. Real symptoms are never mistaken for small talk
        for t, expect in [("my knee is killing me", "question"), ("my face is drooping and my speech is slurred", "999"),
                          ("I feel awful", "question"), ("my stomach hurts", "question"),
                          ("I feel like I might pass out", "question"), ("I keep sneezing", "question"),
                          ("I got stung by a bee", "question"), ("im burning up", "question"),
                          ("I have insomnia", "question"), ("something feels wrong", "question")]:
            page.goto(URL)
            say(t)
            if expect == "999":
                page.wait_for_selector(".result")
                ok = "Call 999 now" in page.inner_text(".result")
            else:
                ok = page.locator(".progress").count() > 0 and "What's bothering you today?" not in chat()
            check("symptom not treated as small talk: " + t, ok)

        # 1e. Unclear messages are treated as a possible symptom, and the chat says so
        page.goto(URL)
        say("asdf jkl")
        check("unclear message: treated as possible symptom, explained", "to be safe I'll treat it as a possible symptom" in chat())

        # 2. Typed answers are understood
        page.goto(URL)
        say("I've had a sore throat for 2 days. No fever.")
        check("echoes what it understood", "Got it: for 2 to 3 days, no high temperature." in chat())
        check("progress shows question count", "question 1 of 1" in chat().lower())
        say("no")
        page.wait_for_selector(".result")
        check("typed 'no' answers the question", "Look after yourself at home" in page.inner_text(".result"))
        check("reassuring opening shown", "likely to get better on its own" in chat())
        check("NHS self-care tips shown", "Things that can help" in chat())
        check("safety net shown, 999 first", "Get help sooner" in chat() and "call 999 now" in page.inner_text(".care-extra"))

        # 2b. Demo case C explains what to do, and the hint goes once an answer is corrected
        page.goto(URL)
        page.click('button[data-case="C"]')
        page.locator(".chips").last.get_by_role("button", name="No", exact=True).click()
        page.wait_for_selector(".result")
        check("demo C shows the hint", "Demo C: now press" in chat())
        page.locator("button[data-panel=edit]").click()
        page.locator("select[data-fact=duration_days]").select_option("3")
        check("hint disappears after correcting", "Demo C: now press" not in chat() and "Book a GP appointment" in chat())

        # 3. An answer it cannot read is asked again once, then counted as not sure
        page.goto(URL)
        say("I have a headache")
        say("hello")
        check("unreadable answer: says it didn't catch it", "didn't catch that" in chat())
        check("unreadable answer: question not skipped", page.locator(".result").count() == 0)
        say("hello again")
        check("second miss counted as not sure, with a note", "not sure" in chat())

        # 4. Typed number for severity
        page.goto(URL)
        say("I have a headache")
        say("7")
        check("typed '7' accepted for severity", "didn't catch" not in chat())

        # 5. Unknown symptom: honest message
        page.goto(URL)
        say("I have a rash on my arm")
        check("unknown symptom explained honestly", "don't have specific rules" in chat())

        # 6. Red flag still immediate, with no questions first
        page.goto(URL)
        say("my chest feels tight")
        page.wait_for_selector(".result")
        check("red flag gives Call 999 at once", "Call 999 now" in page.inner_text(".result")
              and page.locator(".progress").count() == 0)
        check("emergency: calm, with waiting advice", "right thing to do" in chat() and "Do not drive yourself" in chat())

        # 7. Not sure on a red-flag question is treated with caution
        page.goto(URL)
        say("I've had a sore throat for 2 days. No fever.")
        page.locator(".chips").last.get_by_role("button", name="Not sure", exact=True).click()
        page.wait_for_selector(".result")
        check("not sure about swallowing -> See a GP, explained", "Book a GP appointment" in page.inner_text(".result")
              and "precaution" in chat())

        browser.close()
        if errors:
            print("PAGE ERRORS:", errors)
            failures.append("pageerror")
    print("ALL PASSED" if not failures else "FAILED: " + ", ".join(failures))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
