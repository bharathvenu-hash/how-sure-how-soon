"""Build storyboard images for flows A, B and C from the live prototype (demo mode).

Each panel is a real screenshot of the running page, cropped to the
elements that matter for that step, with a short label above it.
Usage: python tools/storyboards.py  (writes docs/storyboards/*.png)
"""
import os
import pathlib

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright


def launch_args():
    """Use CHROME_PATH if set, otherwise Playwright's own Chromium."""
    path = os.environ.get("CHROME_PATH")
    return {"executable_path": path, "args": ["--no-sandbox"]} if path else {}

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / "index.html").as_uri() + "?fast=1&demo=1"
OUT = ROOT / "docs" / "storyboards"
TMP = OUT / "_panels"
SCALE = 2


def font(size, bold=False):
    for f in (["DejaVuSans-Bold.ttf"] if bold else ["DejaVuSans.ttf"]):
        for d in ["/usr/share/fonts/truetype/dejavu/", ""]:
            try:
                return ImageFont.truetype(d + f, size)
            except OSError:
                pass
    return ImageFont.load_default()


def clip(page, first, last, name):
    """Screenshot from the top of element `first` to the bottom of element `last`."""
    a = page.locator(first).last.bounding_box()
    b = page.locator(last).last.bounding_box()
    top = a["y"] - 8
    bottom = b["y"] + b["height"] + 8
    path = TMP / f"{name}.png"
    page.screenshot(path=str(path), clip={"x": 0, "y": top, "width": 520, "height": bottom - top}, full_page=True)
    return path


def compose(name, title, panels):
    """panels: list of (label, sublabel, image path)."""
    imgs = [Image.open(p) for _, _, p in panels]
    w = 520 * SCALE
    gap, pad, head = 40, 40, 150
    height = max(i.size[1] for i in imgs) + head + pad * 2 + 60
    width = len(imgs) * w + (len(imgs) - 1) * gap + pad * 2
    canvas = Image.new("RGB", (width, height), "white")
    d = ImageDraw.Draw(canvas)
    d.text((pad, 20), title, fill="#1f2328", font=font(44, True))
    for i, ((label, sub, _), im) in enumerate(zip(panels, imgs)):
        x = pad + i * (w + gap)
        y = head
        d.rounded_rectangle([x, y - 10, x + w, y + 70], 14, fill="#eef1f5")
        d.text((x + 20, y), f"{i + 1}. {label}", fill="#2f5d8a", font=font(32, True))
        d.text((x + 20, y + 38), sub, fill="#5d6470", font=font(24))
        canvas.paste(im, (x, y + 90))
        d.rectangle([x, y + 90, x + w - 1, y + 90 + im.size[1] - 1], outline="#e2ded6", width=2)
    canvas.save(OUT / f"{name}.png")
    print("saved", name)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_args())
        page = browser.new_page(viewport={"width": 520, "height": 1400}, device_scale_factor=SCALE)
        chip = lambda label: page.locator(".chips").last.get_by_role("button", name=label, exact=True).click()

        # Flow A
        page.goto(URL)
        page.click('button[data-case="A"]')
        a1 = clip(page, ".msg.user", ".chips", "A1")
        chip("No")
        a2 = clip(page, ".result", ".result .reasons", "A2")
        page.locator("button[data-panel=whatif]").click()
        a3 = clip(page, "#whatif", ".result-actions", "A3")
        compose("storyboard-A", "Flow A: sore throat. Certainty and urgency agree.", [
            ("User describes symptom", "Simulated AI extracts 2 days, no fever; asks 1 question", a1),
            ("System responds", "Self-care, high certainty, with the reason", a2),
            ("User asks what would change it", "Answers that would raise urgency, plus a 999 line", a3),
        ])

        # Flow B
        page.goto(URL)
        page.click('button[data-case="B"]')
        b1 = clip(page, ".msg.user", ".msg.user", "B1")
        b2 = clip(page, ".result", ".result .reasons", "B2")
        page.select_option("#format", "unified")
        b3 = clip(page, ".result", ".result .reasons", "B3")
        page.select_option("#format", "decoupled")
        compose("storyboard-B", "Flow B: chest tightness. Low certainty, high urgency.", [
            ("User describes symptom", "Red flag found in the first message", b1),
            ("System responds at once", "No questions; Call 999 now with low certainty", b2),
            ("Research mode: unified format", "Version 1 rating shows amber High risk: NHS 111", b3),
        ])

        # Flow C
        page.goto(URL)
        page.click('button[data-case="C"]')
        chip("No")
        c1 = clip(page, ".result", ".result .reasons", "C1")
        page.locator("button[data-panel=edit]").click()
        c2 = clip(page, "#edit", "#edit", "C2")
        page.locator("select[data-fact=duration_days]").select_option("3")
        c3 = clip(page, ".result", ".result .reasons", "C3")
        compose("storyboard-C", "Flow C: the user corrects an answer.", [
            ("System gives a result", "Self-care, based on 2 to 3 days", c1),
            ("User edits an answer", "Duration changed to more than 2 weeks", c2),
            ("System updates and explains", "Banner says what changed; now See a GP", c3),
        ])
        browser.close()


if __name__ == "__main__":
    main()
