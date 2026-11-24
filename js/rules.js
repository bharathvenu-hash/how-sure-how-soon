/* SureSoon rules engine.
 * Deterministic triage logic. The LLM (or the demo extractor) only supplies facts;
 * every urgency decision is made here.
 * Works in the browser (window.SureSoonRules) and in Node (module.exports) for tests.
 */
(function (root) {
  "use strict";

  // Urgency levels, lowest to highest.
  const LEVELS = [
    { id: 0, key: "selfcare", label: "Self-care", action: "Look after yourself at home", time: "Check again if anything changes" },
    { id: 1, key: "gp", label: "See a GP", action: "Book a GP appointment", time: "Within the next week" },
    { id: 2, key: "nhs111", label: "Contact NHS 111", action: "Contact NHS 111 online or by phone", time: "Today" },
    { id: 3, key: "emergency", label: "Emergency", action: "Call 999 now", time: "Immediately. Do not wait to see if it gets better." }
  ];

  // Follow-up questions. Each one fills one fact.
  const YES_NO = [
    { label: "Yes", value: true },
    { label: "No", value: false },
    { label: "Not sure", value: "unsure" }
  ];
  const QUESTIONS = {
    duration_days: {
      text: "How long have you had this?",
      human: "how long it has lasted",
      options: [
        { label: "Since today", value: 0 },
        { label: "2 to 3 days", value: 2 },
        { label: "About a week", value: 7 },
        { label: "More than 2 weeks", value: 21 },
        { label: "Not sure", value: "unsure" }
      ]
    },
    fever: { text: "Do you have a high temperature, or feel hot and shivery?", human: "whether you have a high temperature", options: YES_NO },
    swallowing_difficulty: { text: "Are you unable to swallow, or drooling?", human: "whether you can swallow", options: YES_NO },
    breathless: { text: "Are you short of breath or finding it hard to breathe?", human: "whether you are short of breath", options: YES_NO },
    pain_spreading: { text: "Does the discomfort spread to your arm, jaw, neck or back?", human: "whether the discomfort spreads", options: YES_NO },
    severity: {
      text: "How bad is it, from 1 (mild) to 10 (worst ever)?",
      human: "how severe it is",
      options: [
        { label: "1 to 3", value: 2 },
        { label: "4 to 6", value: 5 },
        { label: "7 to 8", value: 8 },
        { label: "9 to 10, worst ever", value: 10 },
        { label: "Not sure", value: "unsure" }
      ]
    },
    stiff_neck: { text: "Do you have a stiff neck, or does light hurt your eyes?", human: "whether you have a stiff neck", options: YES_NO }
  };

  // Symptom profiles: which facts matter and the base urgency rule.
  const PROFILES = {
    sore_throat: {
      name: "sore throat",
      required: ["duration_days", "fever", "swallowing_difficulty"],
      base(f) {
        if (f.swallowing_difficulty === true) return [3, "Being unable to swallow, or drooling, with a sore throat needs emergency help (NHS)."];
        if (f.duration_days != null && f.duration_days >= 7) return [1, "A sore throat lasting a week or more should be checked by a GP."];
        if (f.fever === true) return [1, "A sore throat with a high temperature may need a GP check."];
        return [0, "A sore throat without warning signs usually gets better at home within a week."];
      }
    },
    chest: {
      name: "chest discomfort",
      required: ["breathless", "pain_spreading", "duration_days"],
      base(f) {
        if (f.breathless === true) return [3, "Chest discomfort with shortness of breath can be serious."];
        if (f.pain_spreading === true) return [3, "Chest discomfort spreading to the arm, jaw, neck or back can be serious."];
        return [2, "Chest discomfort should always be checked the same day."];
      }
    },
    headache: {
      name: "headache",
      required: ["severity", "stiff_neck", "fever", "duration_days"],
      base(f) {
        if (f.severity != null && f.severity >= 10) return [3, "A sudden, very severe headache can be serious."];
        if (f.stiff_neck === true) return [3, "A headache with a stiff neck, or light hurting your eyes, needs emergency help (NHS)."];
        if (f.duration_days != null && f.duration_days >= 7) return [1, "A headache lasting a week or more should be checked by a GP."];
        return [0, "A mild, short headache usually gets better at home."];
      }
    },
    cough: {
      name: "cough",
      required: ["duration_days", "breathless", "fever"],
      base(f) {
        if (f.breathless === true) return [2, "A cough with shortness of breath should be checked today."];
        if (f.duration_days != null && f.duration_days >= 21) return [1, "A cough lasting three weeks or more should be checked by a GP."];
        return [0, "A short cough without warning signs usually gets better at home."];
      }
    },
    unknown: {
      name: "symptom",
      required: ["duration_days", "severity"],
      base(f) {
        if (f.severity != null && f.severity >= 8) return [2, "Severe symptoms should be checked today."];
        return [1, "I can't assess this symptom well, so a GP is the safest next step."];
      }
    }
  };

  // Symptoms the rules actually cover ("unknown" is a fallback, not coverage).
  function covered(symptom) {
    return !!PROFILES[symptom] && symptom !== "unknown";
  }

  function profileFor(symptom) {
    return PROFILES[symptom] || PROFILES.unknown;
  }

  // Which required facts are still missing (never answered at all).
  function missingFacts(symptom, facts) {
    return profileFor(symptom).required.filter((k) => facts[k] === undefined);
  }

  // Certainty: share of the key facts known. "Not sure" counts as a quarter
  // (it was a half in the first version 2, which made an all-unsure case look
  // moderately certain).
  // Unknown symptoms are capped, because the rules do not cover them.
  function certaintyScore(symptom, facts, extractorConfidence) {
    const req = profileFor(symptom).required;
    let known = 0;
    req.forEach((k) => {
      if (facts[k] === undefined || facts[k] === null) return;
      known += facts[k] === "unsure" ? 0.25 : 1;
    });
    let score = req.length ? known / req.length : 0;
    if (!covered(symptom)) score = Math.min(score, 0.3);
    if (typeof extractorConfidence === "number") score = Math.min(score, extractorConfidence);
    return Math.round(score * 100) / 100;
  }

  // Version 1: one combined rating. Urgency is weighted by certainty.
  function unifiedRating(urgency, certainty) {
    const s = Math.round(urgency * (0.5 + 0.5 * certainty));
    const names = ["Low", "Moderate", "High", "Very high"];
    const colours = ["green", "amber", "amber", "red"];
    return { score: s, label: names[s] + " risk", colour: colours[s], level: LEVELS[s] };
  }

  // Red flags. Checked on the extracted facts AND on the user's raw words,
  // so an extraction miss (by the LLM or the demo extractor) cannot hide them.
  const RAW_RED_FLAGS = [
    { re: /can'?t breathe|cannot breathe|struggling to breathe|gasping/i, why: "Struggling to breathe needs emergency help." },
    { re: /face (is )?(drooping|droop)|slurred speech|can'?t lift (my|both) arms?/i, why: "Signs of a possible stroke need emergency help." },
    { re: /unconscious|passed out|won'?t wake|unresponsive/i, why: "Loss of consciousness needs emergency help." },
    { re: /seizure|fitting|having a fit/i, why: "A seizure needs emergency help." },
    { re: /severe bleeding|bleeding (heavily|a lot)|won'?t stop bleeding/i, why: "Heavy bleeding needs emergency help." },
    { re: /worst headache/i, why: "A sudden, very severe headache can be serious." },
    { re: /chest[^.]*\b(tight|squeez|pressure|heav|crush)|\b(tight|squeez|pressure|heav|crush)\w*[^.]*chest/i,
      why: "Chest pain or discomfort that feels tight, heavy or squeezing needs emergency help (NHS)." },
    { re: /kill myself|suicid|end (it all|my life)|harm(ing)? myself|self[- ]harm|don'?t want to (be alive|live)/i,
      why: "You deserve support right now. If you might act on these thoughts, call 999. You can also call Samaritans free on 116 123, any time." }
  ];
  function redFlags(symptom, facts, rawText) {
    const found = [];
    RAW_RED_FLAGS.forEach((r) => { if (r.re.test(rawText || "")) found.push(r.why); });
    const [u, why] = profileFor(symptom).base(facts);
    if (u === 3) found.push(why);
    return found;
  }

  // Questions where "yes" leads straight to 999. "Not sure" on one of these is treated with caution.
  const RED_FLAG_QUESTIONS = ["swallowing_difficulty", "breathless", "pain_spreading", "stiff_neck"];
  function unsureRedFlagQuestion(symptom, facts) {
    const k = profileFor(symptom).required.find((q) => RED_FLAG_QUESTIONS.indexOf(q) >= 0 && facts[q] === "unsure");
    return k ? QUESTIONS[k].human : null;
  }

  function certaintyLevel(score) {
    return score >= 0.8 ? "high" : score >= 0.6 ? "medium" : "low";
  }

  // Missing or "not sure" facts, in plain words, for the certainty statement.
  function unknownFacts(symptom, facts) {
    return profileFor(symptom).required
      .filter((k) => facts[k] === undefined || facts[k] === null || facts[k] === "unsure")
      .map((k) => QUESTIONS[k].human);
  }

  function listWords(items) {
    if (items.length <= 1) return items.join("");
    return items.slice(0, -1).join(", ") + " or " + items[items.length - 1];
  }

  function certaintyStatement(level, unknown, isRedFlag, known) {
    if (isRedFlag) return "I'm not sure what is causing this, but what you've described needs help now.";
    if (!known) return "I'm not very sure, because my rules don't cover this symptom well.";
    if (level === "high") return "I'm quite sure about this, because you've answered the key questions.";
    if (level === "medium") return "I'm fairly sure, but I don't know " + listWords(unknown) + ".";
    return "I'm not very sure, because I don't know " + listWords(unknown) + ".";
  }

  function assess(symptom, facts, opts) {
    opts = opts || {};
    const profile = profileFor(symptom);
    const flags = redFlags(symptom, facts, opts.rawText);
    let [urgency, reason] = profile.base(facts);
    const reasons = [reason];
    const score = certaintyScore(symptom, facts, opts.extractorConfidence);
    const level = certaintyLevel(score);
    let cautionRaised = false;

    if (flags.length) {
      urgency = 3;
      flags.forEach((f) => { if (reasons.indexOf(f) < 0) reasons.push(f); });
    } else if (urgency < 1 && unsureRedFlagQuestion(symptom, facts)) {
      // "Not sure" about a question that can mean an emergency: be cautious.
      urgency = 1;
      cautionRaised = true;
      reasons.push("You weren't sure " + unsureRedFlagQuestion(symptom, facts) + ", and that can matter, so I've suggested a GP check to be safe.");
    } else if (level === "low" && urgency < 2) {
      // Asymmetric rule: uncertainty can make advice more cautious, never less.
      urgency += 1;
      cautionRaised = true;
      reasons.push("Because I'm unsure, I've suggested a more cautious option.");
    }

    const unknown = unknownFacts(symptom, facts);
    return {
      symptom,
      symptomName: profile.name,
      urgency,
      level: LEVELS[urgency],
      reasons,
      redFlag: flags.length > 0,
      cautionRaised,
      certainty: {
        score,
        level,
        unknown,
        statement: certaintyStatement(level, unknown, flags.length > 0, covered(symptom))
      },
      unified: unifiedRating(urgency, score)
    };
  }

  function lowerFirst(t) { return t.charAt(0).toLowerCase() + t.slice(1); }

  // Plain label for a stored fact value.
  function labelFor(key, value) {
    if (value === undefined || value === null) return "not answered";
    const q = QUESTIONS[key];
    const o = q && q.options.find((x) => x.value === value);
    if (o) return o.label;
    if (key === "duration_days") return value === 1 ? "1 day" : value + " days";
    if (key === "severity") return value + " out of 10";
    return String(value);
  }

  // How a "yes" or a worse answer would be described.
  const IF_WORSE = {
    fever: "you get a high temperature",
    swallowing_difficulty: "you become unable to swallow or start drooling",
    breathless: "you become short of breath",
    pain_spreading: "the discomfort spreads to your arm, jaw, neck or back",
    stiff_neck: "you get a stiff neck or light hurts your eyes"
  };

  // "What would change this?": try each other answer to each key question and
  // report the ones that would raise urgency, plus what would raise certainty.
  function whatWouldChange(symptom, facts, opts) {
    const base = assess(symptom, facts, opts);
    const out = [];
    profileFor(symptom).required.forEach((k) => {
      const q = QUESTIONS[k];
      let best = null;
      q.options.forEach((o) => {
        if (o.value === "unsure" || o.value === facts[k]) return;
        const f = Object.assign({}, facts, { [k]: o.value });
        const r = assess(symptom, f, opts);
        if (r.urgency > base.urgency && (!best || r.urgency > best.r.urgency)) best = { o, r };
      });
      if (!best) return;
      let cond = IF_WORSE[k];
      if (k === "duration_days") cond = "it lasts " + best.o.label.toLowerCase();
      if (k === "severity") cond = "it becomes " + best.o.label.toLowerCase().replace(", worst ever", "") + " out of 10";
      out.push({ kind: "urgency", text: "If " + cond + ": " + lowerFirst(best.r.level.action) + (best.r.urgency < 3 ? " (" + lowerFirst(best.r.level.time) + ")" : "") + "." });
    });
    if (base.certainty.unknown.length && !base.redFlag) {
      out.push({ kind: "certainty", text: "Telling me " + listWords(base.certainty.unknown) + " would make me more sure." });
    }
    if (base.urgency < 3) out.push({ kind: "safety", text: "If you feel much worse or struggle to breathe at any point: call 999." });
    return out;
  }

  const api = { LEVELS, QUESTIONS, PROFILES, profileFor, missingFacts, certaintyScore, certaintyLevel, unifiedRating, redFlags, assess, labelFor, whatWouldChange };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SureSoonRules = api;
})(typeof window !== "undefined" ? window : globalThis);
