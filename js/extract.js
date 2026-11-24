/* Demo-mode fact extractor (SIMULATED).
 * Stands in for the LLM when no API key is given. It uses simple keyword
 * patterns, so it only understands plain wording. It is labelled as simulated
 * in the interface.
 */
(function (root) {
  "use strict";

  const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10 };

  function negated(text, word) {
    const re = new RegExp("(no|not|without|isn'?t|don'?t have|haven'?t got)\\s+(a\\s+|any\\s+)?(\\w+\\s+)?" + word, "i");
    return re.test(text);
  }

  function detectSymptom(t) {
    if (/sore throat|throat (hurts|is sore|pain)|tonsil/i.test(t)) return "sore_throat";
    if (/chest/i.test(t)) return "chest";
    if (/headache|head (hurts|is pounding)|migraine/i.test(t)) return "headache";
    if (/cough/i.test(t)) return "cough";
    return null;
  }

  function duration(t) {
    if (/since (this morning|today|last night)|started today|this morning/i.test(t)) return 0;
    if (/since yesterday|yesterday/i.test(t)) return 1;
    const m = t.match(/(\d+|a|an|one|two|three|four|five|six|seven|ten)\s+(day|week|month)s?/i);
    if (!m) return undefined;
    const n = isNaN(m[1]) ? NUM[m[1].toLowerCase()] : parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    return unit === "day" ? n : unit === "week" ? n * 7 : n * 30;
  }

  function yesNo(t, pattern, word) {
    if (!pattern.test(t)) return undefined;
    return !negated(t, word);
  }

  function extract(text) {
    const t = String(text || "");
    const facts = {};
    const d = duration(t);
    if (d !== undefined) facts.duration_days = d;
    const fever = yesNo(t, /fever|high temperature|temperature|hot and shivery/i, "(fever|high temperature|temperature)");
    if (fever !== undefined) facts.fever = fever;
    const br = yesNo(t, /short of breath|breathless|catch my breath|hard to breathe|difficulty breathing/i, "(short of breath|breathless)");
    if (br !== undefined) facts.breathless = br;
    const sw = yesNo(t, /swallow|drool/i, "(trouble|problem|difficulty)?\\s*swallow");
    if (sw !== undefined) facts.swallowing_difficulty = sw && /can'?t swallow|cannot swallow|unable to swallow|drool/i.test(t);
    const sev = t.match(/(\d+)\s*(\/|out of)\s*10/i);
    if (sev) facts.severity = parseInt(sev[1], 10);
    if (/worst (headache|pain) (of my life|ever)/i.test(t)) facts.severity = 10;
    if (/spread|arm|jaw/i.test(t) && /chest/i.test(t)) facts.pain_spreading = !negated(t, "(spread)");
    const neck = yesNo(t, /stiff neck/i, "stiff neck");
    if (neck !== undefined) facts.stiff_neck = neck;
    return { symptom: detectSymptom(t), facts, confidence: null, source: "demo" };
  }

  const api = { extract };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SureSoonExtract = api;
})(typeof window !== "undefined" ? window : globalThis);
