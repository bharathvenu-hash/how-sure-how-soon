/* Care messages: reassurance and safety-netting, in the way a GP would talk.
 * The rules decide what to do; this only decides how it is said.
 * Tone is matched to urgency so reassurance never weakens advice to get care.
 * Self-care tips follow the NHS website (sore throat, cough, headaches; heart attack for 999 waiting advice).
 * Works in the browser (window.SureSoonCare) and in Node for tests.
 */
(function (root) {
  "use strict";

  const TIPS = {
    sore_throat: [
      "Drink plenty of water, and try cool or soft foods",
      "Adults can gargle with warm, salty water",
      "Paracetamol or ibuprofen can ease the pain (follow the leaflet)",
      "A pharmacist can advise you without an appointment"
    ],
    cough: [
      "Rest and drink plenty of fluids",
      "A warm drink of lemon and honey can soothe it (not for babies under 1)",
      "A pharmacist can suggest cough remedies"
    ],
    headache: [
      "Drink plenty of water and rest",
      "Paracetamol or ibuprofen can help (follow the leaflet)",
      "Try to relax; stress and tension can make headaches worse"
    ],
    unknown: ["A pharmacist can give advice without an appointment"]
  };

  const WHILE_WAITING = {
    chest: ["Sit down and rest while you wait", "Do not drive yourself to hospital"],
    default: ["Stay with someone if you can", "Keep your phone with you"]
  };

  function isCrisis(r) {
    return r.reasons.some((x) => /Samaritans/.test(x));
  }

  // Opening line, chosen by urgency (and certainty, when that view shows it).
  function opening(r, showCertainty) {
    const name = r.symptomName;
    if (isCrisis(r)) return "I'm really glad you told me. You don't have to deal with this on your own, and talking to someone now can help.";
    switch (r.urgency) {
      case 0:
        if (!showCertainty) return "From what you've told me, this is likely to get better on its own.";
        return r.certainty.level === "high"
          ? "That sounds uncomfortable, but from what you've told me it's very likely to get better on its own."
          : "From what you've told me this is likely to settle by itself, although I don't have the full picture.";
      case 1:
        if (r.cautionRaised && showCertainty) return "I don't think this is an emergency. Because I couldn't get the full picture, a GP check is the safe choice. It's a precaution, not a sign that something is wrong.";
        return "This doesn't sound urgent, but it's worth getting your " + name + " checked by a GP this week.";
      case 2:
        return "This doesn't sound like an emergency, but it should be looked at today. NHS 111 can tell you the right place to go, at any time of day or night.";
      default:
        return "I know this may feel frightening. Getting help now is the right thing to do, and the sooner you call, the better.";
    }
  }

  function build(r, whatIf, showCertainty) {
    const out = { opening: opening(r, showCertainty), tips: [], tipsTitle: "", safetyNet: [] };
    if (isCrisis(r)) {
      out.tipsTitle = "Right now";
      out.tips = ["Call 999 if you might act on these thoughts", "Call Samaritans free on 116 123, any time", "If you can, tell someone you trust how you feel"];
      return out;
    }
    if (r.urgency === 3) {
      out.tipsTitle = "While you wait";
      out.tips = (WHILE_WAITING[r.symptom] || WHILE_WAITING.default).slice();
      return out;
    }
    if (r.urgency <= 1) {
      out.tipsTitle = r.urgency === 0 ? "Things that can help" : "Until you're seen";
      out.tips = (TIPS[r.symptom] || TIPS.unknown).slice();
    }
    // Safety-netting: the most urgent changes first, at most two.
    out.safetyNet = whatIf
      .filter((x) => x.kind === "urgency")
      .sort((a, b) => (/999/.test(b.text) ? 1 : 0) - (/999/.test(a.text) ? 1 : 0))
      .slice(0, 2)
      .map((x) => x.text);
    return out;
  }

  // Safety check for reassurance written by an LLM. Any failure: use the template.
  const FALSE_REASSURANCE = /nothing to worry|no need to (worry|see|call|go)|not serious|don'?t worry|probably fine|nothing serious|wait and see|no cause for concern|perfectly normal/i;
  const DIAGNOSIS = /\byou (probably |likely |may |might )?(have|'ve got|got) (a |an )?(infection|strep|tonsillitis|heart attack|angina|migraine|meningitis|cancer|covid|flu|virus|pneumonia)/i;
  function reassuranceSafe(text, r) {
    if (typeof text !== "string") return false;
    const t = text.trim();
    if (t.length < 10 || t.length > 320) return false;
    if (/\d+\s?(mg|ml|tablets?)\b/i.test(t)) return false;            // no doses
    if (DIAGNOSIS.test(t)) return false;                               // no diagnosis
    if (r.urgency >= 1 && FALSE_REASSURANCE.test(t)) return false;     // no false comfort when care is needed
    if (r.urgency < 3 && /\b999\b|ambulance|emergency/i.test(t)) return false; // no alarm that contradicts the advice
    if (r.urgency === 3 && /\b(no need|later|tomorrow|wait)\b/i.test(t)) return false; // no delay for emergencies
    return true;
  }

  const api = { build, opening, reassuranceSafe, TIPS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SureSoonCare = api;
})(typeof window !== "undefined" ? window : globalThis);
