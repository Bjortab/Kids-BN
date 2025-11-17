// ===============================================================
// BN-KIDS — STORY ENGINE (GC v7)
// Fullt omskriven för stabil logik, inga hittepå-element,
// tydliga åldersnivåer, korrekt svenska och bättre flow.
//
// Viktiga nycklar:
// - Kapitellängd styrs hårt av åldersband
// - Ingen spontan fakta (ex: hundens namn) — allt måste förklaras
// - Logik måste hänga ihop (stjärnor i tunneln kräver orsak)
// - Barnets värld styr berättelsen; inga slumpinslag
// - Inga floskler (“äventyret hade bara börjat”, osv)
//
// Exponeras som: window.BNStoryEngine
// ===============================================================

(function (global) {
  "use strict";

  const ENGINE_VERSION = "bn-story-engine-v7";

  // --------------------------------------------------------------
  // Åldersintervall → mål-längd och stil
  // --------------------------------------------------------------
  const AGE_BANDS = {
    "7-8":   { maxChars: 600,  wordGoal: 90,  tone: "väldigt enkel, mjuk, tydlig, konkret" },
    "9-10":  { maxChars: 900,  wordGoal: 140, tone: "enkel, äventyrlig, tydlig, lite mer detaljer" },
    "11-12": { maxChars: 1200, wordGoal: 180, tone: "vardagsmagi, känslor, dialog, logik" },
    "13-14": { maxChars: 1500, wordGoal: 230, tone: "mer detaljerad, känslor, personlig utveckling" },
    "15":    { maxChars: 1800, wordGoal: 280, tone: "tonåring, djupare tankar, konsekvenser, mer dialog" }
  };

  // --------------------------------------------------------------
  // Beräkna åldersband från meta.age
  // --------------------------------------------------------------
  function determineAgeBand(ageInput) {
    if (!ageInput) return AGE_BANDS["11-12"]; // fallback

    let ageStr = String(ageInput);
    let m = ageStr.match(/(\d{1,2})/);
    if (!m) return AGE_BANDS["11-12"];

    const age = parseInt(m[1], 10);

    if (age <= 8) return AGE_BANDS["7-8"];
    if (age <= 10) return AGE_BANDS["9-10"];
    if (age <= 12) return AGE_BANDS["11-12"];
    if (age <= 14) return AGE_BANDS["13-14"];
    return AGE_BANDS["15"];
  }

  // --------------------------------------------------------------
  // Trimma bort halv mening
  // --------------------------------------------------------------
  function trimToWholeSentence(text) {
    let t = (text || "").trim();
    const lastDot = Math.max(t.lastIndexOf("."), t.lastIndexOf("!"), t.lastIndexOf("?"));
    if (lastDot !== -1) return t.slice(0, lastDot + 1);
    return t;
  }

  // --------------------------------------------------------------
  // BYGG SUPERMOTORN-PROMPT
  // --------------------------------------------------------------
  function buildPrompt(opts) {
    const { worldState, storyState, chapterIndex, ageBand } = opts;

    return [
      `Du är BN-KIDS sagomotor (${ENGINE_VERSION}).`,
      `Skriv kapitel ${chapterIndex} för målgruppen ${ageBand.wordGoal} ord.`,
      "",
      "VIKTIGA KRAV:",
      "- Skriv på perfekt och naturlig svenska.",
      "- Inga floskler som 'äventyret hade bara börjat'.",
      "- Använd logik: allt som händer ska ha en tydlig orsak.",
      "- Uppfinn INTE fakta som barnet inte har sagt.",
      "- Om något behöver få ett namn (som ett djur), låt karaktärerna NAMNGE det i kapitlet.",
      "- Om något ovanligt händer (tunnel, ljus, magi) → förklara varför.",
      "",
      "STIL enligt åldern:",
      ageBand.tone,
      "",
      "WORLDSTATE (använd detta, men hitta inte på extra fakta):",
      JSON.stringify(worldState, null, 2),
      "",
      "STORYSTATE (bygg vidare logiskt):",
      JSON.stringify(storyState || {}, null, 2),
      "",
      "STRUKTUR DU SKA FÖLJA:",
      "1. 1–2 meningars recap av förra kapitlet.",
      "2. EN huvudscen som utvecklar berättelsen.",
      "3. Dialog + känslor.",
      "4. Tydlig konkret avslutning utan floskler.",
      "",
      "SVARSFORMAT:",
      "{ \"chapterText\": \"...\", \"storyState\": { ... } }"
    ].join("\n");
  }

  // --------------------------------------------------------------
  // Hämta text från API-svar (OpenAI/Mistral kompatibelt)
  // --------------------------------------------------------------
  function extractModelText(apiResponse) {
    if (!apiResponse) return "";
    if (typeof apiResponse === "string") return apiResponse;
    if (typeof apiResponse.text === "string") return apiResponse.text;
    if (typeof apiResponse.story === "string") return apiResponse.story;

    try {
      if (apiResponse.choices &&
          apiResponse.choices[0] &&
          apiResponse.choices[0].message &&
          typeof apiResponse.choices[0].message.content === "string") {
        return apiResponse.choices[0].message.content;
      }
    } catch (_) {}

    return JSON.stringify(apiResponse);
  }

  // --------------------------------------------------------------
  // Försök tolka JSON från modellen
  // --------------------------------------------------------------
  function extractJson(text) {
    if (!text) return null;
    const first = text.indexOf("{");
    const last  = text.lastIndexOf("}");
    if (first === -1 || last === -1) return null;

    try {
      return JSON.parse(text.slice(first, last + 1));
    } catch (_) {
      return null;
    }
  }

  // --------------------------------------------------------------
  // API-anrop
  // --------------------------------------------------------------
  async function callApi(apiUrl, payload) {
    const r = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload)
    });

    let raw;
    try {
      raw = await r.json();
    } catch (_) {
      raw = await r.text();
    }
    return raw;
  }

  // --------------------------------------------------------------
  // HUVUD: GENERATE CHAPTER
  // --------------------------------------------------------------
  async function generateChapter(opts) {
    const {
      apiUrl = "/api/generate_story",
      worldState,
      storyState = {},
      chapterIndex = 1
    } = opts;

    if (!worldState) throw new Error("BNStoryEngine: worldState saknas.");

    const meta = worldState.meta || {};
    const ageBand = determineAgeBand(meta.age);

    const prompt = buildPrompt({
      worldState,
      storyState,
      chapterIndex,
      ageBand
    });

    const payload = {
      prompt,
      age: meta.age,
      hero: meta.hero,
      length: meta.length,
      engineVersion: ENGINE_VERSION,
      worldState,
      storyState,
      chapterIndex
    };

    const apiRaw = await callApi(apiUrl, payload);
    const modelText = extractModelText(apiRaw);
    const json = extractJson(modelText);

    let chapterText;
    let newState;

    if (json && json.chapterText) {
      chapterText = json.chapterText;
      newState = json.storyState || storyState;
    } else {
      chapterText = modelText;
      newState = storyState;
    }

    // trim till hel mening
    chapterText = trimToWholeSentence(
      chapterText.slice(0, ageBand.maxChars)
    );

    return {
      chapterText,
      storyState: newState,
      engineVersion: ENGINE_VERSION,
      ageBand: ageBand
    };
  }

  // --------------------------------------------------------------
  global.BNStoryEngine = {
    generateChapter,
    ENGINE_VERSION
  };
})(window);
