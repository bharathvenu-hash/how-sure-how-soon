# Development notes

Short notes on what each test showed and what changed as a result. The development record in the [README](../README.md) summarises them.

## Version 1: one combined traffic-light rating

The three demo flows were replayed with [`tools/replay.py`](../tools/replay.py), plus two extra cases.

- **Flow B (chest tightness and shortness of breath).** The first message already contained a red flag, but the system still asked two follow-up questions before showing "Call 999 now", so emergency advice was delayed. *Found by replaying Flow B and counting the turns before the 999 advice appeared.*
- **Sore throat answered "Not sure" twice.** The result was a green "Low risk", the same as for a person who answered every question. The rating hid that the system did not know whether the person could swallow, which is the false reassurance described in Assignment 1. *Found by answering "Not sure" to both questions and comparing the result with a confident run.*
- The duration question had no "Not sure" option, so people had to guess.
- The label "risk" mixed two ideas: how serious the situation might be and how confident the system was.

**Decision for version 2:** split the result into an urgency channel and a certainty channel; stop asking questions as soon as a red flag is found; let low certainty raise urgency but never lower it; add "Not sure" to every question.

## Version 2: separate urgency and certainty channels

- Flow B now shows "Call 999 now" straight after the first message, with the certainty line "I'm not sure what is causing this, but these symptoms need help now."
- Red flags are checked on the extracted facts and on the raw message, so a missed extraction cannot hide them.
- Low certainty raises urgency by one level (never above "Contact NHS 111" without a red flag) and never lowers it.
- With questions stopped for red flags, the old combined formula rated Flow B as amber "High risk: Contact NHS 111", because low certainty pulled the score down. A combined rating can turn an emergency into a same-day call. It is kept as the "Unified" format in research mode for comparison.
- **Problem found:** with "Not sure" counted as half an answer, a sore throat answered "Not sure" three times came out as "moderately sure" and self-care, while the result listed three unknown facts. The reason text also called the sore throat "short-lived" when its duration was unknown.
- **Fix:** "Not sure" now counts as a quarter, and medium certainty starts at 0.6. The same case now gives low certainty and "See a GP" with a note that this is the cautious option. The reason text no longer assumes a duration.

## Version 3: explanation and correction

- **"What would change this?"** tries every other answer to each key question and lists those that would raise urgency, what would make the system more sure, and a standing 999 safety line.
- **"Edit my answers"** lets the user change any answer. The result updates in place, and a banner states which answer changed and whether "How soon" and "How sure" changed. Flow C: changing the duration from "2 to 3 days" to "More than 2 weeks" moves the result from self-care to "Book a GP appointment".
- **"This doesn't seem right"** explains that the result only reflects the answers given, points to them for checking, and gives NHS 111 or a GP as the route for anyone still worried.
- **Bug found:** the list items reused the urgency CSS class and showed as white text on a pale panel. The classes were renamed.

## Version 4: research mode

- A toolbar switches the result between the four formats proposed in Assignment 1: decoupled, unified (the version 1 rating), urgency only and certainty only. The conversation and rules stay the same; only the presentation changes, so the formats can be compared on identical cases.
- On Flow B the unified format shows an amber "High risk: Contact NHS 111" while the other three show "Call 999 now". *Found by running Flow B once in each format and comparing the results.*

## Version 5: live LLM mode

- [`js/llm.js`](../js/llm.js) connects to Gemini, OpenAI or Claude. The model returns JSON with the symptom, the facts stated, its confidence and a one-sentence acknowledgement. It is told not to give advice or urgency.
- Model output is filtered to known fact names and allowed values before it reaches the rules.
- The model's confidence caps the certainty score, so an unsure extraction lowers "How sure".
- If the provider call fails, the app says so and falls back to the simulated extractor.
- The API key is typed into the page, kept in memory for that tab and sent only in the provider's authorisation header. It is never stored or committed.
- Tested with mocked provider responses ([`tools/test_live_mocked.py`](../tools/test_live_mocked.py)): all three request formats, the fallback, and a case where the "model" misses a breathing problem. The raw-text red-flag rule still produced "Call 999 now". First tested against a real model in version 20.

## Version 6: automated tests

[`tests/rules.test.js`](../tests/rules.test.js) (22 tests, run with Node) covers the three storyboard flows, the safety rules, certainty, the explanation list, the unified-rating problem and the demo extractor. One test tries every answer to every question in every profile and checks that urgency is never below the base rule.

Bugs the tests found:
- "I want to kill myself" produced "Contact NHS 111" because there was no crisis rule. A raw-text rule now gives "Call 999 now" and the Samaritans number (116 123).
- Unknown symptoms could reach "high" certainty: the cap for symptoms without rules never applied, because "unknown" is itself a profile. Fixed with a `covered()` check.
- The emergency certainty line was changed to "what you've described needs help now", so it also reads correctly for a crisis message.

## Version 7: rules checked against NHS guidance

Each rule was compared with the NHS pages for [sore throat](https://www.nhs.uk/conditions/sore-throat/), [cough](https://www.nhs.uk/conditions/cough/), [chest pain](https://www.nhs.uk/conditions/chest-pain/), [heart attack](https://www.nhs.uk/conditions/heart-attack/) and [headaches](https://www.nhs.uk/conditions/headaches/) (accessed 24 November 2026). Three rules were less cautious than the NHS:

| Case | Before | NHS guidance | Now |
|---|---|---|---|
| Sore throat, unable to swallow or drooling | Contact NHS 111 | Call 999 | Call 999 |
| Chest that feels tight, heavy or squeezing, no other sign | Contact NHS 111 | Call 999 | Call 999 (raw-text red flag) |
| Headache with a stiff neck or light hurting the eyes | Contact NHS 111 (999 only with fever) | Call 999 | Call 999 |

The swallowing question was reworded from "hard to swallow" to "unable to swallow, or drooling", because painful swallowing is common and is not an NHS emergency sign. Rules that already matched: sore throat not better after a week (GP), cough over 3 weeks (GP), chest pain with breathlessness or spreading (999). Five tests were added (27 in total).

## Version 8: chat-assistant interface

The interface was moved closer to the AI chat tools people already use, since that is where they are likely to meet a health assistant.

- Welcome screen with the capability statement as three cards (what it can do, what it cannot, emergency 999) and the demo cases as suggestion cards. The capability cards stay visible in compact form once the chat starts, so the limits are not hidden after the first message.
- Assistant messages are plain text next to an avatar; user messages are bubbles. A typing indicator paces each reply, except emergency results, which appear at once.
- Rounded message box at the bottom (Enter sends, Shift+Enter adds a line), a "New chat" button, AI settings in a pop-over, and the research-mode "View" menu in the top bar.
- **Problem found:** storyboard screenshots were captured mid fade-in and looked washed out. The `?fast` option used by the scripts now turns off pauses and animation.
- The rules and tests did not change: 27 rule tests and the mocked live tests still pass.

## Version 9: minimal light interface and conversation fixes

Hands-on testing with short messages ("hello", "hi" and a stray single letter) showed three problems: the stray letter was treated as an unknown symptom, "hello" and "hi" were silently counted as "not sure" answers, and the chat ended with "Contact NHS 111". A greeting produced medical advice, and the person was never told their replies were not understood. *Found in hands-on testing of version 8.*

Changes:
- Greetings and very short messages get a friendly reply and symptom buttons. Triage starts only when a symptom is described.
- Answers that cannot be read get "Sorry, I didn't catch that" and the options again. A second miss is counted as "not sure", and the chat says so, because it lowers certainty.
- Typed answers work: yes or no, a number from 1 to 10, an option's label, or "not sure".
- After the first message the assistant says what it understood ("Got it: for 2 to 3 days, no high temperature"), so a misunderstanding can be spotted early. Questions show "Question 1 of 2".
- Unknown symptoms get an honest line: no specific rules, so general questions and cautious advice.
- The interface was simplified and kept light only (no dark theme): symptom buttons and one line of limits on the welcome screen, with the limits line kept at the top during the chat.
- [`tools/test_ui.py`](../tools/test_ui.py) adds 13 browser checks for these cases. Rule tests (27) and mocked live tests still pass.

## Version 10: reassurance and safety-netting

The aim was for the assistant to reassure people the way a GP would, rather than only show a result. The risk is false reassurance (Assignment 1): comforting words that undercut advice to get care. So the rules still decide what to do, and the new care message only decides how it is said.

- **Tone matched to urgency.** Self-care: "That sounds uncomfortable, but from what you've told me it's very likely to get better on its own." GP: "worth getting checked this week". NHS 111: "doesn't sound like an emergency, but it should be looked at today". 999: "I know this may feel frightening. Getting help now is the right thing to do."
- **What helps.** NHS self-care tips for self-care and GP results ("Things that can help", "Until you're seen"); NHS waiting advice for 999 ("Sit down and rest", "Do not drive yourself to hospital"); Samaritans and 999 for a crisis message.
- **Safety-netting.** "Get help sooner if things change", with the two most urgent answers from "What would change this?", 999 first.
- Certainty appears only in the views that show it, so the research formats stay comparable.
- **Live mode:** the LLM writes the opening line from the fixed decision. `reassuranceSafe()` rejects false comfort when care is needed, diagnoses, doses, alarm that contradicts the advice, and any delay for emergencies; the template is used instead. Mocked test: "Don't worry, you probably have tonsillitis. Take 500 mg of paracetamol." is blocked.
- **Safety fix found in testing:** "Not sure" to "Are you unable to swallow, or drooling?" gave green self-care. "Not sure" on any question that can lead to 999 now gives at least "See a GP", explained as a precaution.
- Tests: 35 rule tests (8 new), 18 browser checks, and mocked live tests including safe and unsafe reassurance.

## Version 11: health-content check before triage

"HELLO Good Morning" started a triage for an unknown symptom. Version 9 recognised greetings from a fixed list, which can never cover every way of saying hello. The rule was reversed: triage starts only when the message has health content (a symptom, a body part, words such as pain, sore or feel awful, or a red-flag phrase). Anything else gets "What's bothering you today?" and symptom buttons. In live mode the LLM gets a chance to find a symptom before a message is treated as small talk.

The risk in this change is the opposite error, a real symptom treated as small talk, so the browser tests check both directions: four non-health messages give no triage, while "my knee is killing me", "I feel awful", "my stomach hurts" and a stroke description ("face drooping, speech slurred", which gives "Call 999 now") all start properly. 26 browser checks, 35 rule tests and the mocked live tests pass.

## Version 12: friendly replies and a clear scope

- Small talk gets a natural reply instead of a generic prompt: greetings by time of day ("Good morning! I'm HowSure…"), "how are you?" ("I'm doing well, thanks for asking! More importantly, how are you feeling?"), thanks, goodbye (with a 999 reminder), and "what can you do?" (capabilities, and that it cannot diagnose).
- Off-topic questions (sport, films and music, weather, news, technology, food, jokes, study, money, travel) get a polite scope line, for example "I can only help with health questions, so I can't talk about sport. Is anything bothering you health-wise?" This states the limits at the moment someone tests them.
- The follow-up prompt is shortened after the first time so replies do not repeat word for word.
- **Bug found by the new tests:** "who won the football last night?" started a triage, because "football" contains "foot". Short health words are now matched as whole words ("ear" was also inside "year" and "learn").
- 32 browser checks, 35 rule tests and the mocked live tests pass.

## Version 13: when unsure, treat it as a possible symptom

Tricky messages were tested against the health-content check from version 11. Two kinds of error appeared:

- **Off-topic messages containing a health word started a triage** ("it is so cold today", "my phone screen is broken"). This is harmless: the person can start a new chat.
- **Real symptoms were treated as small talk** ("I feel like I might pass out", "I keep sneezing", "I got stung by a bee", "im burning up"). This is dangerous: the person is brushed off.

This is the same asymmetry as in Assignment 1, so the default was reversed. A message is treated as small talk only when it is clearly a greeting, a pleasantry or a known off-topic subject. Anything uncertain is treated as a possible symptom, and the assistant says so: "to be safe I'll treat it as a possible symptom… If it isn't about your health, just press New chat." More symptom words were added (sneezing, pass out, burning up, can't sleep, stung, allergy, wheezing). Remaining limit: the demo extractor is keyword-based, so unusual wording can still be misread; live mode uses the LLM for this.

Tests: 39 browser checks (10 real-symptom phrasings, non-health messages, the unclear-message line), 35 rule tests and the mocked live tests pass.

## Version 14: renamed to SureSoon

The prototype was renamed from HowSure to SureSoon, so the name holds both signals: how sure and how soon. The repository keeps the tagline as its name (`how-sure-how-soon`). Earlier notes keep the old name, as they record what happened at the time.

## Version 15: introductions

"my name is Bharath" fell into the safe default from version 13 and was treated as a possible symptom. Introductions are now recognised: "Nice to meet you, Bharath! I'm SureSoon. Is anything bothering you health-wise?" The name is then used once in the symptom acknowledgement ("Sorry to hear about your sore throat, Bharath."). It stays in the page for that chat only; it is never stored or sent anywhere, and in live mode it is not included in the prompt. 41 browser checks pass.

## Version 16: hint for demo case C

Demo case C looked identical to case A, with no cue for the next step. It now shows a hint after the result: "Demo C: now press Edit my answers and change how long you've had it to More than 2 weeks…". The hint disappears once an answer is corrected. 43 browser checks pass.

## Version 17: examples backed by UK data, and less leading

The four symptom buttons were an arbitrary choice and could lead people towards one of them (anchoring, L06), although examples help people start (recognition over recall, L05).

- The examples now follow UK data on how often adults reported each symptom over two weeks, from a UK population survey of 2,474 adults ([Elliott, McAteer and Hannaford, 2011](https://doi.org/10.1186/1471-2296-12-16)): headache 845, sore throat 411, cough 372. Chest discomfort (chest pain 108) is less common but stays as the emergency case, and the welcome screen says so.
- The person's own words come first ("Describe what's bothering you in your own words"). The examples sit below, smaller, under "Not sure how to start? Try a common one:", with a dashed "Something else" button that returns to the message box.
- Limit: the survey's most common symptoms also include tiredness, joint pain, back pain and difficulty sleeping, which SureSoon has no rules for. These are planned.
- 47 browser checks, 35 rule tests and the mocked live tests pass.

## Version 18: current UK data for the examples

The 2011 survey used in version 17 was dated. A 2024 UK survey with the same two-week question (Living Self-Care Survey: 3,255 adults, January to September 2024; [El-Osta, Altalib, Al Ammouri and Smith, 2025](https://doi.org/10.1101/2025.06.01.25328757)) gives headaches 49.5%, cough 14.0% and sore throat 13.1%, so the order is now Headache, Cough, Sore throat, then Chest discomfort as the emergency case. The same survey's other common symptoms (back pain 33.1%, joint pain 27.1%, indigestion 17.9%, cold or flu 12.7%, diarrhoea 12.2%) have no rules yet and are planned.

## Version 19: demo case buttons removed from the welcome screen

The "Demo cases: A, B, C" links looked like part of the product and competed with the symptom examples. They are removed for visitors; the README gives the three flows as messages to type. Adding `?demo` to the address still shows them, because the replay, storyboard and test scripts use them. A new browser check confirms that visitors do not see them (48 checks pass).

## Version 20: first test against a real model

Live mode was run from the local [`index.html`](../index.html) with a free Gemini API key on 24 November 2026.

- **Retired model found.** The default, `gemini-2.5-flash`, was rejected: Google reported that it is no longer available to new users and named `gemini-3.8-flash` as the replacement. The app showed the error, switched to the simulated extractor and continued the triage, as designed.
- **Default updated.** With `gemini-3.8-flash`, the key was accepted and the provider answered, but reported temporary high demand. The fallback again worked as designed.
- **Fix:** the default model is now `gemini-3.8-flash`, and a busy provider (status 429, 500 or 503) gets one retry after 1.5 seconds before the app falls back.
- **What this shows:** the browser-to-provider connection, key handling and the real-error fallback work. A complete live extraction depends on provider availability and is still to be confirmed. 35 rule tests and the mocked live tests pass.
