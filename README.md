# How Sure, How Soon: Communicating Uncertainty and Urgency in AI Health Self-Triage

Project report by Bharath Badri Venugopalan, Student ID 3204674

**SureSoon** is the prototype for my project *How Sure, How Soon*: a research prototype for AI health self-triage. It shows **how soon** to get care (urgency) and **how sure** the system is (certainty) as two separate signals. A language model, or a simulated stand-in, reads what the person says; fixed rules decide urgency.
## Project status

**Chat interface.** Implemented in the style of an AI assistant: a minimal welcome screen, symptom buttons, a typing indicator, two to four follow-up questions that also accept typed answers, and a result card. Covered by 47 browser checks.

**Result card.** Implemented, with separate "How soon" and "How sure" channels.

**Rules engine.** Implemented: red flags checked on both the extracted facts and the raw words, a base urgency for each symptom, a certainty score and a cautious rule. Covered by 35 automated tests and checked against NHS guidance.

**Care message.** Implemented as templates: reassurance matched to urgency, NHS self-care tips and safety-netting. Wording written by a language model must pass a safety check; this has been tested with mocked replies.

**Explanation and correction.** "What would change this?", "Edit my answers" and "This doesn't seem right" are implemented.

**Research mode.** Implemented, with four result formats: decoupled, unified (version 1), urgency only and certainty only.

**Demo extractor.** A simulated AI: keyword rules stand in for the language model, so the prototype works without a key.

**Live LLM adapter.** Implemented for Gemini, OpenAI and Claude, using the reviewer's own key. Tested with mocked replies; a real Gemini call reached the provider (see item 21 below).

**Planned.** A plug-in for existing assistants, a calmer tone for health anxiety, a user study and clinician-reviewed rules.

Limits: the rules cover four symptoms (sore throat, chest discomfort, headache, cough) plus an "unknown" fallback. They follow NHS website guidance but are not clinically validated. The demo extractor only understands plain wording.

## Technology stack

- **HTML, CSS and plain JavaScript**, no framework or build step, so the page opens straight from the file system.
- **`js/rules.js`**: the deterministic rules engine. Runs in the browser and in Node for tests.
- **`js/extract.js`**: the demo extractor (simulated AI).
- **`js/care.js`**: the care message (reassurance, NHS self-care tips, safety-netting) and the safety check for LLM-written reassurance.
- **`js/llm.js`**: the LLM adapter. Default models: `gemini-3.8-flash`, `gpt-4o-mini`, `claude-haiku-5-5`; any model name can be typed in. The model returns JSON facts, a confidence score and a one-sentence reply. It never sets urgency.
- **Node.js** for the rule tests; **Python with Playwright** for the replay, storyboard and mocked live-mode scripts.
- **AI tools used in development:** Claude (Anthropic); see [AI assistance](#ai-assistance).
- Undecided: which model works best in live mode, and whether the plug-in should be a browser extension or an MCP server.

## Running or inspecting the work

**Try it online (no key needed):** https://bharathvenu-hash.github.io/how-sure-how-soon/

**Or run it locally:** open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Type a symptom, or try the three flows from the report: **A** "I've had a sore throat for 2 days. No fever." then answer No; **B** "I've got a vague tightness in my chest and I feel a bit short of breath."; **C** as A, then press *Edit my answers* and change the duration. The research-mode menu switches the display format. Adding `?demo` to the address shows one-click buttons for these flows (used by the scripts).

**Live mode with your own key:** open *AI settings*, choose *Live*, pick a provider, paste your key and press *Apply*. The key stays in that browser tab, is sent only to the chosen provider and is never saved. No key is stored in this repository. Serving the folder over `http://localhost` (as above) is more reliable than opening the file directly.

**Tests and replays:**

```bash
node tests/rules.test.js                 # 35 rule and care-message tests
pip install playwright && playwright install chromium
python tools/test_live_mocked.py         # live mode with mocked provider replies
python tools/test_ui.py                  # 47 conversation checks (small talk, off-topic, typed answers, care message)
python tools/replay.py                   # screenshots of flows A, B, C -> docs/screenshots
python tools/storyboards.py              # storyboard images -> docs/storyboards
```

Set `CHROME_PATH` to use an installed Chrome instead of Playwright's Chromium. The scripts open the page with `?fast`, which skips the typing pauses and animations.

**Where things are:** `docs/diagram/` (system diagram), `docs/storyboards/` (figures for the report), `docs/screenshots/` (result screens), `docs/dev-notes.md` (what each version changed and how each problem was found).

## Development record

Each version was tested before the next change. Details are in [`docs/dev-notes.md`](docs/dev-notes.md).

1. **Version 1: one combined rating**. Chat, follow-up questions and a traffic light with urgency weighted by certainty. Testing showed two problems: Flow B asked two questions before "Call 999", and a sore throat answered "Not sure" twice showed the same green "Low risk" as a confident one (details in [`docs/dev-notes.md`](docs/dev-notes.md)).
2. **Version 2: separate channels**. Split the result into "How soon" and "How sure"; red flags stop the questions; low certainty raises urgency but never lowers it. Testing found that counting "Not sure" as half an answer made an all-unsure case look moderately certain, so it now counts as a quarter.
3. **Version 3: explanation and correction**. Added "What would change this?" and "Edit my answers", which recalculates and states what changed. Fixed a CSS clash that hid the list text.
4. **Version 4: research mode**. The four formats from Assignment 1 on the same case. On Flow B the unified rating showed amber "High risk: Contact NHS 111" for an emergency.
5. **Version 5: live LLM mode**. Adapter for three providers, output filter, fallback, key kept in memory. Checked with mocked replies, including a "model" that misses a breathing problem: the raw-text rule still gave "Call 999 now".
6. **Version 6: automated tests**. The tests found two safety bugs, now fixed: a self-harm message got "Contact NHS 111" instead of 999 and the Samaritans number, and unknown symptoms could reach high certainty.
7. **Figures**. System diagram and storyboards generated from the running prototype.
8. **Rules checked against NHS guidance**. Three rules were less cautious than the NHS website and now give "Call 999 now": sore throat with inability to swallow or drooling, chest that feels tight or squeezing, and headache with a stiff neck or light hurting the eyes. Five tests added.
9. **Chat-assistant interface**. After trying it, I redesigned the interface to feel like the AI chat tools people already use: welcome screen with the capability cards, typing indicator, rounded message box. The rules did not change.
10. **Conversation fixes from my own test**. Typing "hi" and "hello" started a triage and ended with "Contact NHS 111". Greetings now get a friendly reply, unreadable answers are asked again, typed answers work, SureSoon says what it understood, and the interface is minimal and light only.
11. **Reassurance like a GP**. Care message matched to urgency, NHS self-care tips and safety-netting; LLM-written reassurance must pass a safety check. Also: "Not sure" on a question that can mean 999 now gives at least "See a GP".
12. **Any non-health message gets a friendly prompt**. "HELLO Good Morning" started a triage, so a triage now starts only when the message has health content; tests check that real symptoms are never treated as small talk.
13. **Friendly replies and a clear scope**. Natural replies to greetings, "how are you?" and thanks; off-topic questions (sport, films, news…) get "I can only help with health questions". Fixed "football" matching "foot".
14. **When unsure, treat it as a possible symptom**. Testing found real symptoms ("I feel like I might pass out") treated as small talk. Small talk is now only clear greetings and known off-topic subjects; anything uncertain is treated as a possible symptom, and SureSoon says so.
15. **Renamed to SureSoon**. The name now holds both signals, how sure and how soon. Earlier notes use the old name, HowSure.
16. **Introductions**. "my name is bharath" was treated as a possible symptom; introductions now get a friendly reply and the name is used in that chat only (never stored).
17. **Hint for demo case C**. Case C looked identical to case A when I tried it, so a hint now points to Edit my answers.
18. **Examples backed by UK data, less leading**. Symptom examples ordered by how often UK adults report them, placed below the message box with "Something else", so they help people start without steering them.
19. **Current UK data**. The examples now follow a 2024 UK survey of 3,255 adults ([El-Osta et al., 2025](https://doi.org/10.1101/2025.06.01.25328757)): headache, cough, sore throat; chest discomfort stays as the emergency case.
20. **Demo case buttons removed for visitors**. They looked like part of the product; the flows are now given here as messages to type, and `?demo` shows the buttons for the scripts.
21. **First test against a real model**. A real Gemini call showed that the default model had been retired; the app fell back safely. The default is now `gemini-3.8-flash`, and a busy provider gets one retry before the fallback.

## AI assistance

- **Tool:** Claude (Anthropic)


## Additional files

No ZIP is needed; everything is in this repository. Figures used in the report are in `docs/diagram/` and `docs/storyboards/`.

## References

The literature behind the design choices is listed in the project report.
