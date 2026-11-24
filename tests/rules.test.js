// Tests for the rules engine and the demo extractor. Run: node tests/rules.test.js
const assert = require("assert");
const R = require("../js/rules.js");
const X = require("../js/extract.js");
const C = require("../js/care.js");

let passed = 0;
const failed = [];
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed.push(name); console.log("  FAIL " + name + "\n       " + e.message); }
}
const run = (text, answers) => {
  const x = X.extract(text);
  const facts = Object.assign({}, x.facts, answers || {});
  return R.assess(x.symptom || "unknown", facts, { rawText: text });
};

console.log("Storyboard flows");
test("Flow A: sore throat, 2 days, no fever, swallows fine -> self-care, high certainty", () => {
  const r = run("I've had a sore throat for 2 days. No fever.", { swallowing_difficulty: false });
  assert.strictEqual(r.level.key, "selfcare");
  assert.strictEqual(r.certainty.level, "high");
});
test("Flow B: chest tightness + short of breath -> 999 with low certainty, before any question", () => {
  const x = X.extract("I've got a vague tightness in my chest and I feel a bit short of breath.");
  assert.ok(R.redFlags(x.symptom, x.facts, "").length > 0, "red flag found from first message");
  const r = R.assess(x.symptom, x.facts, {});
  assert.strictEqual(r.level.key, "emergency");
  assert.strictEqual(r.certainty.level, "low");
  assert.ok(/not sure what is causing this/.test(r.certainty.statement));
});
test("Flow C: correcting duration to more than 2 weeks -> See a GP", () => {
  const r = run("I've had a sore throat for 2 days. No fever.", { swallowing_difficulty: false, duration_days: 21 });
  assert.strictEqual(r.level.key, "gp");
});

console.log("Safety rules");
test("Low certainty raises urgency by one level", () => {
  const r = R.assess("sore_throat", { duration_days: "unsure", fever: "unsure", swallowing_difficulty: "unsure" });
  assert.strictEqual(r.level.key, "gp");
  assert.ok(r.cautionRaised);
});
test("Uncertainty never lowers urgency (every profile, every single answer)", () => {
  Object.keys(R.PROFILES).forEach((s) => {
    R.PROFILES[s].required.forEach((k) => {
      R.QUESTIONS[k].options.forEach((o) => {
        const facts = { [k]: o.value };
        const base = R.PROFILES[s].base(facts)[0];
        assert.ok(R.assess(s, facts).urgency >= base, s + " " + k + "=" + o.value);
      });
    });
  });
});
test("Cautious rule never jumps to 999 without a red flag", () => {
  const r = R.assess("unknown", {});
  assert.ok(r.urgency <= 2);
});
[
  "I can't breathe",
  "my face is drooping and my speech is slurred",
  "he passed out and is unresponsive",
  "she is having a seizure",
  "worst headache of my life",
  "the cut won't stop bleeding",
  "I want to kill myself"
].forEach((t) => test("Raw-text red flag: \"" + t + "\" -> 999", () => {
  assert.strictEqual(run(t).level.key, "emergency");
}));
test("Red flags work even if extraction found nothing (unknown symptom)", () => {
  assert.strictEqual(R.assess("unknown", {}, { rawText: "I can't breathe" }).level.key, "emergency");
});

console.log("Checked against NHS guidance (nhs.uk)");
test("Sore throat and unable to swallow or drooling -> 999", () => {
  assert.strictEqual(R.assess("sore_throat", { swallowing_difficulty: true }).level.key, "emergency");
});
test("Chest that feels tight, with no other sign -> 999", () => {
  assert.strictEqual(run("my chest feels tight").level.key, "emergency");
  assert.strictEqual(run("there is a squeezing pressure in my chest").level.key, "emergency");
});
test("Chest discomfort without NHS 999 signs stays at NHS 111 today", () => {
  assert.strictEqual(run("my chest aches a bit when I cough", { breathless: false, pain_spreading: false, duration_days: 2 }).level.key, "nhs111");
});
test("Headache with stiff neck or light hurting eyes -> 999", () => {
  assert.strictEqual(R.assess("headache", { stiff_neck: true, fever: false }).level.key, "emergency");
});
test("Sore throat not better after a week -> GP; cough over 3 weeks -> GP", () => {
  assert.strictEqual(R.assess("sore_throat", { duration_days: 7, fever: false, swallowing_difficulty: false }).level.key, "gp");
  assert.strictEqual(R.assess("cough", { duration_days: 21, fever: false, breathless: false }).level.key, "gp");
});

console.log("Certainty");
test("All key facts answered -> high", () => {
  assert.strictEqual(R.assess("cough", { duration_days: 3, breathless: false, fever: false }).certainty.level, "high");
});
test("Unknown symptom is capped at low certainty", () => {
  assert.strictEqual(R.assess("unknown", { duration_days: 2, severity: 3 }).certainty.level, "low");
});
test("LLM confidence caps certainty", () => {
  const r = R.assess("cough", { duration_days: 3, breathless: false, fever: false }, { extractorConfidence: 0.4 });
  assert.strictEqual(r.certainty.level, "low");
});
test("Statement names the unknown facts", () => {
  const r = R.assess("sore_throat", { duration_days: 2, fever: "unsure", swallowing_difficulty: false });
  assert.ok(/high temperature/.test(r.certainty.statement));
});

console.log("Explanation and research formats");
test("What would change this lists the swallowing escalation for Flow A", () => {
  const list = R.whatWouldChange("sore_throat", { duration_days: 2, fever: false, swallowing_difficulty: false });
  assert.ok(list.some((x) => /unable to swallow/.test(x.text) && /999/.test(x.text)));
});
test("Unified rating downgrades the Flow B emergency (the version 1 problem)", () => {
  const r = R.assess("chest", { breathless: true });
  assert.strictEqual(r.urgency, 3);
  assert.ok(r.unified.score < 3, "unified score " + r.unified.score);
});

console.log("Demo extractor");
test("Durations: '3 weeks' -> 21, 'since yesterday' -> 1", () => {
  assert.strictEqual(X.extract("cough for 3 weeks").facts.duration_days, 21);
  assert.strictEqual(X.extract("headache since yesterday").facts.duration_days, 1);
});
test("Negation: 'no fever' -> false, 'not short of breath' -> false", () => {
  assert.strictEqual(X.extract("sore throat, no fever").facts.fever, false);
  assert.strictEqual(X.extract("cough, not short of breath").facts.breathless, false);
});

console.log("Care messages (reassurance and safety-netting)");
test("Not sure about a 999 question (swallowing) -> at least See a GP", () => {
  const r = R.assess("sore_throat", { duration_days: 2, fever: false, swallowing_difficulty: "unsure" });
  assert.strictEqual(r.level.key, "gp");
  assert.ok(r.reasons.some((x) => /weren't sure whether you can swallow/.test(x)));
});
test("Self-care: reassuring opening, NHS tips and a 999 safety net", () => {
  const f = { duration_days: 2, fever: false, swallowing_difficulty: false };
  const r = R.assess("sore_throat", f);
  const c = C.build(r, R.whatWouldChange("sore_throat", f), true);
  assert.ok(/likely to get better on its own/.test(c.opening));
  assert.ok(c.tips.length >= 3);
  assert.ok(/999/.test(c.safetyNet[0]), "most urgent safety net first");
});
test("Emergency: calm and direct, waiting advice, no self-care tips", () => {
  const c = C.build(R.assess("chest", { breathless: true }), [], true);
  assert.ok(/right thing to do/.test(c.opening));
  assert.deepStrictEqual(c.tips, ["Sit down and rest while you wait", "Do not drive yourself to hospital"]);
});
test("Crisis message gives Samaritans and 999, not self-care", () => {
  const r = R.assess("unknown", {}, { rawText: "I want to kill myself" });
  const c = C.build(r, [], true);
  assert.ok(c.tips.some((t) => /116 123/.test(t)) && c.tips.some((t) => /999/.test(t)));
});
test("Views without certainty never mention certainty in the care message", () => {
  const r = R.assess("sore_throat", { duration_days: "unsure", fever: "unsure", swallowing_difficulty: false });
  assert.ok(!/full picture/.test(C.build(r, [], false).opening));
});
test("Safety check rejects false reassurance when care is needed", () => {
  const r = R.assess("cough", { duration_days: 21, fever: false, breathless: false });
  assert.strictEqual(C.reassuranceSafe("Don't worry, this is nothing serious.", r), false);
});
test("Safety check rejects diagnosis, doses, needless alarm and delay", () => {
  const ok = R.assess("sore_throat", { duration_days: 2, fever: false, swallowing_difficulty: false });
  const em = R.assess("chest", { breathless: true });
  assert.strictEqual(C.reassuranceSafe("You probably have tonsillitis, which is common.", ok), false);
  assert.strictEqual(C.reassuranceSafe("Take 500 mg of paracetamol and rest.", ok), false);
  assert.strictEqual(C.reassuranceSafe("This could be an emergency, so stay alert.", ok), false);
  assert.strictEqual(C.reassuranceSafe("It's fine to wait and call later if it continues.", em), false);
});
test("Safety check accepts calm, matching reassurance", () => {
  const ok = R.assess("sore_throat", { duration_days: 2, fever: false, swallowing_difficulty: false });
  assert.strictEqual(C.reassuranceSafe("A sore throat can feel miserable, but it usually settles within a week.", ok), true);
});

console.log("\n" + passed + " passed, " + failed.length + " failed");
process.exit(failed.length ? 1 : 0);
