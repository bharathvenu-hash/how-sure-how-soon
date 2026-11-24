/* SureSoon interface: conversation flow and result rendering. */
(function () {
  "use strict";
  const R = window.SureSoonRules;
  const X = window.SureSoonExtract;
  const L = window.SureSoonLLM;
  const C = window.SureSoonCare;
  const ai = { mode: "demo", provider: "gemini", model: "", key: "" };
  const MAX_QUESTIONS = 4;
  // ?fast skips the typing pauses (used by the replay and test scripts).
  const FAST = /[?&]fast\b/.test(location.search) ||
    (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const sleep = (ms) => new Promise((r) => setTimeout(r, FAST ? 0 : ms));
  if (FAST) document.documentElement.classList.add("fast");
  // Demo case buttons are hidden from visitors; ?demo shows them for the replay and test scripts.
  const DEMO = /[?&]demo\b/.test(location.search);

  const chat = document.getElementById("chat");
  const input = document.getElementById("input");

  let state;
  let format = "decoupled"; // research mode: decoupled | unified | urgency | certainty
  function reset() {
    state = { symptom: null, facts: {}, asked: [], pending: null, result: null, rawText: "", confidence: null, busy: false };
    chat.innerHTML = "";
    onboarding();
    input.focus();
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function add(node) { chat.appendChild(node); chat.scrollTop = chat.scrollHeight; return node; }
  // Assistant messages: avatar + plain text, like a chat assistant.
  function botRow(inner) {
    const row = el("div", "msg bot");
    row.appendChild(el("div", "avatar"));
    const body = el("div", "body");
    if (typeof inner === "string") body.innerHTML = inner; else body.appendChild(inner);
    row.appendChild(body);
    return add(row);
  }
  function bot(text) { return botRow(text); }
  function user(text) {
    const row = el("div", "msg user");
    row.appendChild(el("div", "body", escapeHtml(text)));
    return add(row);
  }
  // Typing indicator before each reply, so the pace feels like a conversation.
  async function typing(ms) {
    if (FAST) return;
    const t = botRow('<span class="typing"><span></span><span></span><span></span></span>');
    await sleep(ms || 550);
    t.remove();
  }
  async function say(text, ms) { await typing(ms); return bot(text); }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // Welcome screen: minimal. The limits line stays visible once the chat starts.
  // Example symptoms, ordered by how often UK adults reported them in the two weeks
  // before a 2024 survey of 3,255 adults (El-Osta et al., 2025, Living Self-Care Survey):
  // headache 49.5%, cough 14.0%, sore throat 13.1%.
  // Chest discomfort is less common but included because it can be an emergency.
  const STARTERS = [
    ["Headache", "I have a headache"],
    ["Cough", "I have a cough"],
    ["Sore throat", "I have a sore throat"],
    ["Chest discomfort", "I have some chest discomfort"]
  ];
  // Examples are optional: "Something else" sends the person back to their own words,
  // so the buttons support recognition (L05) without anchoring the choice (L06).
  function starterButtons(cls) {
    const box = el("div", cls);
    STARTERS.forEach(([label, text]) => {
      const b = el("button", "", label);
      b.addEventListener("click", () => send(text));
      box.appendChild(b);
    });
    const other = el("button", "other", "Something else");
    other.addEventListener("click", () => {
      input.placeholder = "Describe it in your own words...";
      input.focus();
    });
    box.appendChild(other);
    return box;
  }
  function onboarding() {
    const w = el("section", "welcome");
    w.innerHTML =
      '<div class="logo" aria-hidden="true"></div>' +
      "<h1>How are you feeling?</h1>" +
      '<p class="lead">Describe what\'s bothering you in your own words, in the box below. After a few quick questions I\'ll say <b>how soon</b> to get care, and <b>how sure</b> I am.</p>' +
      '<div class="examples-label">Not sure how to start? Try a common one:</div>';
    w.appendChild(starterButtons("starter"));
    w.appendChild(el("div", "examples-source", "Ordered by how often UK adults reported them in a 2024 survey (El-Osta et al., 2025). Chest discomfort is less common, but included because it can be an emergency."));
    const limits = el("div", "limits",
      "I can suggest how soon to get care for one main symptom" +
      '<span class="sep">·</span>I can\'t diagnose; this is a research prototype' +
      '<span class="sep">·</span><span class="em">Emergency? Call 999 now</span>');
    w.appendChild(limits);
    if (DEMO) {
      w.appendChild(el("div", "cases",
        'Demo cases: <button data-case="A">A: sore throat</button>' +
        '<button data-case="B">B: chest tightness</button>' +
        '<button data-case="C">C: correct an answer</button>'));
    }
    add(w);
    state.welcome = w;
    w.querySelectorAll("button[data-case]").forEach((b) => b.addEventListener("click", () => { state.demoCase = b.dataset.case; send(CASES[b.dataset.case]); }));
  }

  // Start a triage only when the message has health content. Greetings, small talk
  // and anything else get a friendly prompt instead (version 9 used a fixed list of
  // greetings, which missed "HELLO Good Morning").
  const HEALTH_WORDS = new RegExp("(" + [
    // whole words (short words would otherwise match inside "football", "year", "alarm")
    "\\b(pain|pains|painful|hurt|hurts|hurting|ache|aches|aching|sore|sick|ill|unwell|poorly|fever|temperature|rash|itchy|itch|swollen|swelling|bleed|bleeding|blood|vomit|vomiting|nausea|nauseous|diarrhoea|diarrhea|dizzy|faint|fainted|tired|exhausted|cough|coughing|breath|breathe|breathing|chest|throat|head|headache|migraine|stomach|tummy|belly|back|ear|ears|eye|eyes|skin|tooth|teeth|cold|flu|infection|burn|burnt|cut|injury|injured|fell|fall|broke|broken|lump|numb|tingling|weak|spot|spots|symptom|symptoms|knee|knees|leg|legs|arm|arms|hand|hands|foot|feet|neck|shoulder|hip|joint|joints|muscle|bone|wrist|ankle|finger|toe|nose|mouth|lip|lips|tongue|gum|gums|jaw|period|pregnant|pregnancy|urine|pee|wee|constipated|constipation|bowel|heart|pulse|palpitations|face|drooping|droop|slurred|speech|seizure|fit|unconscious|drooling|swallow|swallowing|anxious|anxiety|panic|depressed|depression|doctor|gp|hospital|111|999|emergency|medicine|medication)\\b",
    // phrases
    "feel(ing)? (bad|awful|terrible|rough|off|funny|strange|weird|low|sick|ill|unwell)", "not feeling", "can'?t (sleep|eat|stop|breathe|move|walk|see|hear)",
    "passed out", "pass out", "throw(ing)? up", "sneez", "burning up", "dreadful", "can.?t sleep|cannot sleep|insomnia", "stung|sting|bitten|bite", "allerg", "wheez", "sweat", "killing me", "struggl", "hard to", "suicid", "kill myself", "harm myself", "self[- ]harm"
  ].join("|") + ")", "i");
  // Small talk only when the message is CLEARLY a greeting, pleasantry or a known
  // off-topic subject. Anything uncertain is treated as a possible symptom: a needless
  // question is harmless, but brushing off a real symptom is not (Assignment 1 asymmetry).
  const PLEASANTRY = /\b(my name is|my name'?s|call me|i'?m called|nice to meet you|hi|hii+|hello|hey|hiya|yo|howdy|greetings|good (morning|afternoon|evening|night)|morning|thanks?|thank you|cheers|bye|goodbye|see you|how are you|how'?s it going|who are you|what are you|what can you do|what do you do|your name|ok|okay|cool|nice|great|lol|test(ing)?)\b/i;
  function smallTalk(text) {
    if (HEALTH_WORDS.test(text)) return false;
    const x = X.extract(text);
    if (x.symptom || Object.keys(x.facts).length) return false;
    if (text.replace(/[^a-z0-9]/gi, "").length < 3) return true;   // "?", "ok", "..."
    return PLEASANTRY.test(text) || OFF_TOPIC.some(([re]) => re.test(text));
  }

  // Friendly replies for small talk, and a clear, polite scope line for off-topic questions.
  const OFF_TOPIC = [
    [/football|soccer|cricket|rugby|tennis|f1|formula|match|score|premier league|sport|game|team|player|goal/i, "sport"],
    [/movie|film|cinema|netflix|series|tv show|actor|actress|music|song|album|band|concert/i, "films, TV or music"],
    [/weather|rain|sunny|forecast/i, "the weather"],
    [/news|politic|election|government|prime minister|president/i, "news or politics"],
    [/code|coding|program|python|javascript|computer|laptop|phone|app\b/i, "technology"],
    [/recipe|cook|food|restaurant|eat out/i, "food and cooking"],
    [/joke|funny|laugh/i, "jokes"],
    [/homework|essay|assignment|exam|maths|math/i, "study help"],
    [/money|bank|price|stock|crypto|invest/i, "money"],
    [/travel|holiday|flight|hotel/i, "travel"]
  ];
  function partOfDay() {
    const h = new Date().getHours();
    return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  }
  const ASK = " What's bothering you today? You can describe it, or pick one below.";
  const ASK_AGAIN = " Is anything bothering you health-wise?";
  function friendlyReply(text) {
    const t = text.toLowerCase();
    const ask = state.prompted ? ASK_AGAIN : ASK;
    state.prompted = true;
    // Introductions: use the name in this chat only (it is never stored or sent anywhere).
    const nm = text.match(/(?:my name is|my name'?s|call me|i'?m called)\s+([a-z][a-z'-]{1,30})/i);
    if (nm) {
      state.name = nm[1].charAt(0).toUpperCase() + nm[1].slice(1).toLowerCase();
      return "Nice to meet you, " + escapeHtml(state.name) + "! I'm SureSoon." + ask;
    }
    if (/nice to meet you/.test(t)) return "Nice to meet you too!" + ask;
    if (/\b(thank|thanks|cheers|ta)\b/.test(t)) return "You're welcome. If anything else is bothering you, I'm here." ;
    if (/\b(bye|goodbye|see you|good night|goodnight)\b/.test(t)) return "Take care of yourself. If anything changes, come back any time, and in an emergency call 999.";
    if (/how are you|how'?s it going|how do you do|you ok\b|you alright/.test(t)) return "I'm doing well, thanks for asking! More importantly, how are you feeling?" + (ask === ASK ? ASK : "");
    if (/who are you|what are you|what can you do|what do you do|your name|help me\b/.test(t))
      return "I'm SureSoon, a research prototype. I ask a few questions about one symptom, then tell you how soon to get care and how sure I am. I can't diagnose." + ask;
    for (const [re, topic] of OFF_TOPIC) {
      if (re.test(t)) return "That sounds interesting, but I can only help with health questions, so I can't talk about " + topic + "." + ask;
    }
    const m = t.match(/good (morning|afternoon|evening)/);
    if (m) return "Good " + m[1] + "! I'm SureSoon. I can help you decide how soon to get care for a symptom." + ask;
    if (/\b(hi|hello|hey|hiya|yo|howdy|greetings|morning)\b/.test(t)) return "Hello, and good " + partOfDay() + "! I'm SureSoon. I can help you decide how soon to get care for a symptom." + ask;
    return "I'm not sure I understood. I can help with health symptoms." + ask;
  }

  // Typed answers to the current question ("yes", "no", "7", "not sure").
  function typedAnswer(key, text) {
    const t = text.trim().toLowerCase();
    if (/^(not sure|unsure|don'?t know|dont know|dunno|no idea|maybe|idk)\b/.test(t)) return "unsure";
    const q = R.QUESTIONS[key];
    const isBool = q.options.some((o) => o.value === true);
    if (isBool && /^(yes|yeah|yep|yup|y|i am|i do|it does)\b/.test(t)) return true;
    if (isBool && /^(no|nope|nah|n|not really|i'?m not|i don'?t|it doesn'?t)\b/.test(t)) return false;
    if (key === "severity") {
      const m = t.match(/^(\d{1,2})\b/);
      if (m && +m[1] >= 1 && +m[1] <= 10) return +m[1];
    }
    const opt = q.options.find((o) => o.label.toLowerCase() === t);
    return opt ? opt.value : undefined;
  }

  // Short summary of what was understood, so people can see it and correct it.
  function echo(found) {
    const parts = [];
    const f = found.facts;
    if (typeof f.duration_days === "number") parts.push("for " + R.labelFor("duration_days", f.duration_days).toLowerCase().replace(/^since/, "since"));
    if (f.fever === false) parts.push("no high temperature");
    if (f.fever === true) parts.push("a high temperature");
    if (f.breathless === true) parts.push("short of breath");
    if (f.breathless === false) parts.push("not short of breath");
    if (typeof f.severity === "number") parts.push(f.severity + " out of 10");
    return parts.length ? "Got it: " + parts.join(", ") + "." : "";
  }

  const CASES = {
    A: "I've had a sore throat for 2 days. No fever.",
    B: "I've got a vague tightness in my chest and I feel a bit short of breath.",
    C: "I've had a sore throat for 2 days. No fever."
  };

  function merge(found) {
    if (found.symptom && !state.symptom) state.symptom = found.symptom;
    Object.keys(found.facts).forEach((k) => { if (state.facts[k] === undefined) state.facts[k] = found.facts[k]; });
  }

  // Extraction: the live LLM if configured, otherwise the simulated extractor.
  // If the LLM call fails, fall back to the simulated extractor and say so.
  async function understand(text) {
    if (ai.mode !== "live" || !ai.key) return X.extract(text);
    const thinking = botRow('<span class="typing"><span></span><span></span><span></span></span>');
    try {
      const found = await L.call(ai, text, { symptom: state.symptom, pending: state.pending });
      thinking.remove();
      if (found.reply) bot(escapeHtml(found.reply) + ' <span class="tag">AI</span>');
      return found;
    } catch (e) {
      thinking.remove();
      add(el("div", "msg note", "The AI could not be reached (" + escapeHtml(e.message) + "). Using the simulated extractor instead."));
      return X.extract(text);
    }
  }

  function setBusy(b) {
    state.busy = b;
    document.getElementById("send").disabled = b;
  }

  async function send(text) {
    text = (text || "").trim();
    if (!text || state.busy) return;
    if (state.welcome) state.welcome.classList.add("compact");
    document.querySelectorAll(".chips, .symptom-chips").forEach((c) => c.remove());
    user(text);
    input.value = "";
    autosize();
    if (state.result) {
      if (smallTalk(text)) return say(friendlyReply(text).replace(ASK, "").replace(ASK_AGAIN, "") + " If you'd like to check another symptom, press <b>New chat</b> (the + at the top).");
      return say("If you'd like to check something else, press <b>New chat</b> (the + at the top).");
    }
    setBusy(true);

    // Answering a question: accept typed yes / no / numbers / "not sure".
    if (state.pending) {
      const key = state.pending;
      const v = typedAnswer(key, text);
      if (v !== undefined) {
        state.facts[key] = v;
        state.pending = null;
        state.rawText += " " + text;
        state.missedAnswer = 0;
        await next();
        return setBusy(false);
      }
    }

    // Before any symptom: greetings get a friendly reply, not a triage.
    let preFound = null;
    if (!state.symptom && smallTalk(text) && ai.mode === "live" && ai.key) {
      preFound = await understand(text);           // the LLM may still find a symptom
      if (preFound.symptom && preFound.symptom !== "unknown") preFound.keep = true;
    }
    if (!state.symptom && smallTalk(text) && !(preFound && preFound.keep)) {
      await say(friendlyReply(text));
      add(starterButtons("symptom-chips"));
      return setBusy(false);
    }

    const found = preFound && preFound.keep ? preFound : await understand(text);
    if (typeof found.confidence === "number") {
      state.confidence = state.confidence == null ? found.confidence : Math.min(state.confidence, found.confidence);
    }

    // An answer I couldn't read: say so and ask again once, instead of guessing.
    if (state.pending && found.facts[state.pending] === undefined && !found.symptom) {
      const key = state.pending;
      state.missedAnswer = (state.missedAnswer || 0) + 1;
      if (state.missedAnswer === 1) {
        await say("Sorry, I didn't catch that. Tap one of the options, or type <i>not sure</i>.");
        showChips(key);
        return setBusy(false);
      }
      state.facts[key] = "unsure";
      add(el("div", "msg note", "I'll count that as \u201cnot sure\u201d, which makes me a little less certain."));
    } else if (state.pending && found.facts[state.pending] === undefined) {
      state.facts[state.pending] = "unsure";
    }
    state.pending = null;
    state.missedAnswer = 0;

    const firstSymptom = !state.symptom && found.symptom;
    merge(found);
    state.rawText += " " + text;
    if (!state.symptom) {
      state.symptom = "unknown";
      if (!R.redFlags("unknown", state.facts, state.rawText).length) {
        if (HEALTH_WORDS.test(text)) {
          await say("Thanks for telling me. I don't have specific rules for that symptom yet, so I'll ask a couple of general questions and keep my advice on the cautious side.");
        } else {
          await say("I'm not completely sure what you mean, so to be safe I'll treat it as a possible symptom and ask a couple of general questions. If it isn't about your health, just press <b>New chat</b>.");
        }
      }
    } else if (firstSymptom && !R.redFlags(state.symptom, state.facts, state.rawText).length) {
      const e = echo(found);
      await say("Sorry to hear about your " + R.profileFor(state.symptom).name + (state.name ? ", " + escapeHtml(state.name) : "") + "." + (e ? ' <span class="echo">' + e + "</span>" : ""));
    }
    await next();
    setBusy(false);
  }

  async function next() {
    // Red flags end the conversation at once: no questions before emergency advice.
    if (R.redFlags(state.symptom, state.facts, state.rawText).length) return showResult(true);
    const missing = R.missingFacts(state.symptom, state.facts);
    if (missing.length && state.asked.length < MAX_QUESTIONS) return ask(missing[0]);
    return showResult(false);
  }

  async function ask(key) {
    const q = R.QUESTIONS[key];
    state.pending = key;
    state.asked.push(key);
    const total = Math.min(MAX_QUESTIONS, state.asked.length - 1 + R.missingFacts(state.symptom, state.facts).length);
    await typing();
    const m = bot('<div class="progress">Question ' + state.asked.length + " of " + total + "</div>" + q.text);
    showChips(key);
    return m;
  }

  function showChips(key) {
    const q = R.QUESTIONS[key];
    const chips = add(el("div", "chips"));
    q.options.forEach((o) => {
      const b = el("button", "chip", o.label);
      b.addEventListener("click", async () => {
        if (state.busy) return;
        chips.remove();
        user(o.label);
        state.facts[key] = o.value;
        state.pending = null;
        state.missedAnswer = 0;
        setBusy(true);
        await next();
        setBusy(false);
      });
      chips.appendChild(b);
    });
  }

  function assess() {
    return R.assess(state.symptom, state.facts, { rawText: state.rawText, extractorConfidence: state.confidence });
  }

  // Decoupled card: urgency and certainty are separate channels.
  function urgencyBlock(r) {
    return '<div class="urgency u' + r.urgency + '">' +
      '<div class="ulabel">How soon</div>' +
      '<div class="uaction">' + r.level.action + "</div>" +
      '<div class="utime">' + r.level.time + "</div></div>";
  }
  function certaintyBlock(r) {
    const n = { low: 1, medium: 2, high: 3 }[r.certainty.level];
    let bars = "";
    for (let i = 1; i <= 3; i++) bars += '<span class="bar' + (i <= n ? " on" : "") + '"></span>';
    return '<div class="certainty c-' + r.certainty.level + '">' +
      '<div class="clabel">How sure <span class="meter" aria-label="certainty ' + r.certainty.level + '">' + bars + "</span> " + r.certainty.level + "</div>" +
      '<div class="cstate">' + r.certainty.statement + "</div></div>";
  }

  // The four presentation formats from the Assignment 1 study design.
  function signalBlocks(r) {
    if (format === "unified") {
      return '<div class="unified"><div class="light ' + r.unified.colour + '"></div><div>' +
        '<div class="title">' + r.unified.label + "</div>" +
        '<div class="act">' + r.unified.level.action + "</div></div></div>";
    }
    if (format === "urgency") return urgencyBlock(r);
    if (format === "certainty") return '<div class="plain">' + r.level.action + "</div>" + certaintyBlock(r);
    return urgencyBlock(r) + certaintyBlock(r);
  }

  async function showResult(urgent) {
    const r = assess();
    state.result = r;
    state.llmCare = null;
    // Emergencies are shown without the typing pause.
    if (!urgent) await typing(800);
    // Live mode: the LLM may word the reassurance, but only if it passes the safety check.
    if (ai.mode === "live" && ai.key && !urgent) {
      try {
        const t = await Promise.race([L.reassure(ai, r), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 8000))]);
        state.llmCare = C.reassuranceSafe(t, r) ? t : null;
        state.llmCareRejected = !!t && !state.llmCare;
      } catch (e) { state.llmCare = null; }
    }
    const wrap = el("div");
    state.careEl = el("p", "care-open");
    state.card = el("div", "card result");
    state.careExtra = el("div", "care-extra");
    wrap.appendChild(state.careEl);
    wrap.appendChild(state.card);
    wrap.appendChild(state.careExtra);
    botRow(wrap);
    renderCard(r, null);
    chat.scrollTop = chat.scrollHeight;
  }

  // The caring words around the card. Certainty is only mentioned in views that show it.
  function renderCare(r) {
    const showCertainty = format === "decoupled" || format === "certainty";
    const care = C.build(r, R.whatWouldChange(state.symptom, state.facts, { rawText: state.rawText, extractorConfidence: state.confidence }), showCertainty);
    const useLLM = state.llmCare && showCertainty;
    state.careEl.innerHTML = (r.urgency === 3 ? "<b>Please act on this now.</b> " : "") +
      escapeHtml(useLLM ? state.llmCare : care.opening) + (useLLM ? ' <span class="tag">AI</span>' : "");
    let html = "";
    if (care.tips.length) {
      html += '<div class="care-block"><div class="care-title">' + care.tipsTitle + "</div><ul>" +
        care.tips.map((t) => "<li>" + t + "</li>").join("") + "</ul></div>";
    }
    if (care.safetyNet.length) {
      html += '<div class="care-block net"><div class="care-title">Get help sooner if things change</div><ul>' +
        care.safetyNet.map((t) => "<li>" + t.replace(/^If /, "If ") + "</li>").join("") + "</ul></div>";
    }
    if (html) html += '<div class="care-source">This advice follows NHS website guidance.</div>';
    // Demo case C: tell the person what to try, until they have corrected an answer.
    if (state.demoCase === "C" && !state.corrections) {
      html += '<div class="demo-hint">Demo C: now press <b>Edit my answers</b> and change how long you\'ve had it to <b>More than 2 weeks</b>, to see the result update and explain why.</div>';
    }
    state.careExtra.innerHTML = html;
  }

  function renderCard(r, diff) {
    const c = state.card;
    renderCare(r);
    const changes = R.whatWouldChange(state.symptom, state.facts, { rawText: state.rawText, extractorConfidence: state.confidence });
    c.innerHTML =
      (diff ? '<div class="diff"><b>Updated.</b> ' + diff + "</div>" : "") +
      "<h3>Result for your " + r.symptomName + "</h3>" +
      signalBlocks(r) +
      '<div class="reasons"><b>Why:</b> ' + r.reasons.join(" ") + "</div>" +
      '<div class="panel" id="whatif" hidden><b>What would change this?</b><ul>' +
      changes.map((x) => '<li class="wi-' + x.kind + '">' + x.text + "</li>").join("") + "</ul></div>" +
      '<div class="panel" id="edit" hidden><b>Your answers</b> <span class="sub">Change any answer and the result updates.</span>' + editRows() + "</div>" +
      '<div class="panel" id="wrong" hidden>Thanks for telling me. I can only use the answers above, so please check them. ' +
      "If you are worried, contact NHS 111 or your GP whatever this tool says.</div>" +
      '<div class="result-actions">' +
      '<button class="btn" data-panel="whatif">What would change this?</button>' +
      '<button class="btn" data-panel="edit">Edit my answers</button>' +
      '<button class="btn" data-panel="wrong">This doesn\'t seem right</button>' +
      '<button class="btn" id="restart">New chat</button></div>';
    c.querySelectorAll("button[data-panel]").forEach((b) => b.addEventListener("click", () => {
      const p = c.querySelector("#" + b.dataset.panel);
      p.hidden = !p.hidden;
      if (b.dataset.panel === "wrong") state.feedback = (state.feedback || 0) + 1;
    }));
    c.querySelectorAll("select[data-fact]").forEach((sel) => sel.addEventListener("change", () => correct(sel.dataset.fact, sel.value)));
    c.querySelector("#restart").addEventListener("click", reset);
    if (diff) c.querySelector("#edit").hidden = false;
  }

  function editRows() {
    return R.profileFor(state.symptom).required.map((k) => {
      const q = R.QUESTIONS[k];
      const cur = state.facts[k];
      let opts = q.options.slice();
      if (cur !== undefined && !opts.some((o) => o.value === cur)) opts.unshift({ label: R.labelFor(k, cur), value: cur });
      const sel = '<select data-fact="' + k + '">' +
        (cur === undefined ? '<option value="">Not answered</option>' : "") +
        opts.map((o, i) => '<option value="' + i + '"' + (o.value === cur ? " selected" : "") + ">" + o.label + "</option>").join("") +
        "</select>";
      state.editOpts = state.editOpts || {};
      state.editOpts[k] = opts;
      return '<label class="editrow"><span>' + q.text + "</span>" + sel + "</label>";
    }).join("");
  }

  // Correcting an answer: recompute and say exactly what changed and why.
  function correct(key, idx) {
    if (idx === "") return;
    const before = state.result;
    const oldVal = state.facts[key];
    const val = state.editOpts[key][parseInt(idx, 10)].value;
    state.facts[key] = val;
    const r = assess();
    state.result = r;
    const parts = ["You changed \u201c" + R.QUESTIONS[key].text + "\u201d from " + R.labelFor(key, oldVal) + " to " + R.labelFor(key, val) + "."];
    if (r.urgency !== before.urgency) parts.push("How soon changed from \u201c" + before.level.action + "\u201d to \u201c" + r.level.action + "\u201d.");
    else parts.push("How soon did not change.");
    if (r.certainty.level !== before.certainty.level) parts.push("How sure changed from " + before.certainty.level + " to " + r.certainty.level + ".");
    state.corrections = (state.corrections || 0) + 1;
    renderCard(r, parts.join(" "));
  }

  document.getElementById("applySettings").addEventListener("click", () => {
    ai.mode = document.getElementById("mode").value;
    ai.provider = document.getElementById("provider").value;
    ai.model = document.getElementById("model").value.trim();
    ai.key = document.getElementById("key").value.trim();
    const badge = document.getElementById("modeBadge");
    const live = ai.mode === "live" && ai.key;
    const names = { gemini: "Gemini", openai: "OpenAI", anthropic: "Claude" };
    badge.textContent = live ? "Live: " + names[ai.provider] + " (" + (ai.model || L.DEFAULT_MODELS[ai.provider]) + ")" : "Demo: simulated AI";
    badge.className = "badge" + (live ? " live" : "");
    if (ai.mode === "live" && !ai.key) add(el("div", "msg note", "Live mode needs an API key. Still using the simulated AI."));
    document.getElementById("settings").open = false;
  });
  // View menu: a custom list that opens below the button (the native select
  // popup covered the buttons beside it). It drives the hidden #format select.
  const viewMenu = document.getElementById("viewMenu");
  const formatSel = document.getElementById("format");
  function syncViewMenu() {
    viewMenu.querySelectorAll("[data-format]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.format === formatSel.value)));
    document.getElementById("viewName").textContent = formatSel.options[formatSel.selectedIndex].text;
  }
  viewMenu.querySelectorAll("[data-format]").forEach((b) => b.addEventListener("click", () => {
    formatSel.value = b.dataset.format;
    formatSel.dispatchEvent(new Event("change"));
    viewMenu.open = false;
  }));
  document.addEventListener("click", (e) => {
    document.querySelectorAll(".menu-pop[open], .settings-pop[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; });
  });
  formatSel.addEventListener("change", syncViewMenu);

  document.getElementById("format").addEventListener("change", (e) => {
    format = e.target.value;
    if (state.result) renderCard(state.result, null);
  });
  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  }
  document.getElementById("newChat").addEventListener("click", () => { if (!state.busy) reset(); });
  document.getElementById("send").addEventListener("click", () => send(input.value));
  input.addEventListener("input", autosize);
  // Enter sends, Shift+Enter adds a new line.
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input.value); }
  });
  reset();
})();
