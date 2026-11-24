/* LLM adapter (live mode).
 * The model only extracts facts and writes a short acknowledgement.
 * It never decides urgency: js/rules.js does that.
 * The API key is held in memory for this tab only. It is never stored or committed.
 */
(function (root) {
  "use strict";

  const DEFAULT_MODELS = {
    gemini: "gemini-3.8-flash",
    openai: "gpt-4o-mini",
    anthropic: "claude-haiku-5-5"
  };

  const SYSTEM = [
    "You are the language part of SureSoon, a symptom self-triage research prototype.",
    "Your only jobs: (1) extract facts the user has clearly stated, (2) write a short, calm acknowledgement.",
    "Never give medical advice, never say how urgent anything is, never suggest a diagnosis. Separate rules decide urgency.",
    "Return JSON only, with this shape:",
    '{"symptom": "sore_throat" | "chest" | "headache" | "cough" | "unknown" | null,',
    ' "facts": {"duration_days": number | "unsure", "fever": true | false | "unsure", "swallowing_difficulty": true | false | "unsure",',
    '           "breathless": true | false | "unsure", "pain_spreading": true | false | "unsure", "severity": 1-10 | "unsure", "stiff_neck": true | false | "unsure"},',
    ' "confidence": number from 0 to 1 (how confident you are that you understood the user correctly),',
    ' "reply": "one sentence, at most 20 words, acknowledging what they said"}',
    "Only include a fact if the user stated it. Leave out anything they did not mention.",
    "Use symptom null if the message does not name a symptom, and unknown if it names one not in the list."
  ].join("\n");

  function userPrompt(text, ctx) {
    return "Current symptom so far: " + (ctx.symptom || "none") + "\n" +
      (ctx.pending ? "The user is answering the question about: " + ctx.pending + "\n" : "") +
      "User message: " + text;
  }

  function parseJson(raw) {
    const t = String(raw || "").replace(/^```(json)?/i, "").replace(/```\s*$/, "").trim();
    const start = t.indexOf("{"), end = t.lastIndexOf("}");
    return JSON.parse(t.slice(start, end + 1));
  }

  // Keep only known facts with allowed values, so a malformed reply cannot inject anything.
  const BOOL_FACTS = ["fever", "swallowing_difficulty", "breathless", "pain_spreading", "stiff_neck"];
  const SYMPTOMS = ["sore_throat", "chest", "headache", "cough", "unknown"];
  function clean(obj) {
    const facts = {};
    const f = (obj && obj.facts) || {};
    BOOL_FACTS.forEach((k) => { if (f[k] === true || f[k] === false || f[k] === "unsure") facts[k] = f[k]; });
    if (typeof f.duration_days === "number" && f.duration_days >= 0) facts.duration_days = Math.round(f.duration_days);
    if (f.duration_days === "unsure") facts.duration_days = "unsure";
    if (typeof f.severity === "number" && f.severity >= 1 && f.severity <= 10) facts.severity = Math.round(f.severity);
    if (f.severity === "unsure") facts.severity = "unsure";
    const conf = typeof obj.confidence === "number" ? Math.max(0, Math.min(1, obj.confidence)) : null;
    return {
      symptom: SYMPTOMS.indexOf(obj.symptom) >= 0 ? obj.symptom : null,
      facts,
      confidence: conf,
      reply: typeof obj.reply === "string" ? obj.reply.slice(0, 200) : "",
      source: "llm"
    };
  }

  // Busy providers (429, 500, 503) get one retry after a short pause before
  // the app falls back to the simulated extractor.
  async function send(cfg, system, prompt, maxTokens) {
    try {
      return await sendOnce(cfg, system, prompt, maxTokens);
    } catch (e) {
      if (![429, 500, 503].includes(e.status)) throw e;
      await new Promise((r) => setTimeout(r, 1500));
      return sendOnce(cfg, system, prompt, maxTokens);
    }
  }

  function fail(res, data) {
    const e = new Error((data && data.error && data.error.message) || res.status);
    e.status = res.status;
    return e;
  }

  // One request to the chosen provider; returns the model's text.
  async function sendOnce(cfg, system, prompt, maxTokens) {
    const model = cfg.model || DEFAULT_MODELS[cfg.provider];
    let res, data;
    if (cfg.provider === "gemini") {
      res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 }
        })
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw fail(res, data);
      return data.candidates[0].content.parts.map((p) => p.text).join("");
    }
    if (cfg.provider === "openai") {
      res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
        body: JSON.stringify({
          model, temperature: 0, response_format: { type: "json_object" },
          messages: [{ role: "system", content: system }, { role: "user", content: prompt }]
        })
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw fail(res, data);
      return data.choices[0].message.content;
    }
    if (cfg.provider === "anthropic") {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": cfg.key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({ model, max_tokens: maxTokens || 400, temperature: 0, system, messages: [{ role: "user", content: prompt }] })
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw fail(res, data);
      return data.content.map((p) => p.text || "").join("");
    }
    throw new Error("Unknown provider");
  }

  async function call(cfg, text, ctx) {
    const raw = await send(cfg, SYSTEM, userPrompt(text, ctx), 400);
    return clean(parseJson(raw));
  }

  // Reassurance in the model's own words. The decision is fixed and passed in;
  // the reply is checked by SureSoonCare.reassuranceSafe before it is shown.
  const CARE_SYSTEM = [
    "You are the voice of SureSoon, a symptom self-triage research prototype. Speak like a calm, kind GP.",
    "The advice has ALREADY been decided by safety rules. Never change it, soften it or add to it.",
    "Write 1 or 2 short sentences that acknowledge how the person may feel and support the advice.",
    "Do not diagnose. Do not mention medicines or doses. Do not say 'don't worry' or 'nothing serious' unless the advice is self-care.",
    "Only mention 999 or an emergency if the advice is to call 999. If it is, be calm and direct, and do not suggest waiting.",
    'Return JSON only: {"text": "..."}'
  ].join("\n");

  async function reassure(cfg, r) {
    const prompt = "Symptom: " + r.symptomName + "\nAdvice: " + r.level.action + " (" + r.level.time + ")" +
      "\nCertainty: " + r.certainty.level + " (" + r.certainty.statement + ")";
    const raw = await send(cfg, CARE_SYSTEM, prompt, 200);
    const obj = parseJson(raw);
    return typeof obj.text === "string" ? obj.text.trim() : "";
  }

  const api = { call, clean, parseJson, reassure, DEFAULT_MODELS, SYSTEM, CARE_SYSTEM };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SureSoonLLM = api;
})(typeof window !== "undefined" ? window : globalThis);
