// ===============================================================
// BN-KIDS — STORY ENGINE (GC v8)
// Fullt omskriven för stabil logik, inga hittepå-element,
// tydliga åldersnivåer, korrekt svenska och bättre flow.
//
// Fokus i v8 jämfört med v7:
// - Bättre respekt för vad som redan hänt i tidigare kapitel
// - Särskild hantering när barnet vill "avsluta boken"
//   (ingen reset av hjältens utveckling, inget "lära sig från början igen")
// - Tydligare instruktioner mot upprepning av samma händelse
//
// Exponeras som: window.BNStoryEngine
// ===============================================================

(function (global) {
  "use strict";

  const ENGINE_VERSION = "bn-story-engine-v8";

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
    const lastDot = Math.max(
      t.lastIndexOf("."),
      t.lastIndexOf("!"),
      t.lastIndexOf("?")
    );
    if (lastDot !== -1) return t.slice(0, lastDot + 1);
    return t;
  }

  // --------------------------------------------------------------
  // BYGG SUPERMOTORN-PROMPT
  // --------------------------------------------------------------
  function buildPrompt(opts) {
    const { worldState, storyState, chapterIndex, ageBand } = opts;

    const meta = worldState && worldState.meta ? worldState.meta : {};
    const ageLabel = meta.ageLabel || "7–8 år";
    const hero = meta.hero || "hjälten";

    // Försök plocka ut ev. tidigare sammanfattning från storyState
    const prevSummary = storyState && typeof storyState.summary === "string"
      ? storyState.summary.trim()
      : "";

    const recapHint = prevSummary
      ? `Sammanfattning av berättelsen hittills (skriven tidigare):\n${prevSummary}\n\n`
      : "Använd WORLDSTATE och tidigare kapitel för att förstå vad som redan hänt.\n\n";

    // Baslista med hårda krav – här förstärker vi kontinuitet / logik
    const hardRules = [
      "- Skriv på perfekt och naturlig svenska.",
      "- Använd logik: allt som händer ska ha en tydlig orsak.",
      "- Uppfinn INTE fakta som barnet inte har sagt.",
      "- ÄNDRA INTE på sådant som redan hänt i tidigare kapitel.",
      "- Om hjälten redan har lärt sig något i tidigare kapitel (t.ex. cykla, använda magi, spruta eld),",
      "  ska det här visas som något hen KAN. Börja inte om från början med samma träning.",
      "- Upprepa inte exakt samma händelse igen (t.ex. 'lära sig cykla' eller 'lära sig flyga') som om det vore första gången.",
      "- Om något behöver få ett namn (som ett djur), låt karaktärerna NAMNGE det i kapitlet.",
      "- Om något ovanligt händer (tunnel, ljus, magi) → förklara varför."
    ].join("\n");

    return [
      `Du är BN-KIDS sagomotor (${ENGINE_VERSION}).`,
      `Du skriver kapitel ${chapterIndex} för barn i åldern ${ageLabel}.`,
      `Målsnitt är ungefär ${ageBand.wordGoal} ord, men kvalitet och logik är viktigare än exakt längd.`,
      "",
      "VIKTIGA KRAV:",
      hardRules,
      "",
      "STIL enligt åldern:",
      ageBand.tone,
      "",
      "WORLDSTATE (använd detta, men hitta inte på extra fakta):",
      JSON.stringify(worldState, null, 2),
      "",
      "STORYSTATE (bygg vidare logiskt, ändra inte historien bakåt i tiden):",
      JSON.stringify(storyState || {}, null, 2),
      "",
      recapHint,
      "STRUKTUR DU SKA FÖLJA:",
      "1. 1–2 meningars recap av förra kapitlet (utan att hitta på nya saker).",
      "2. EN huvudscen som utvecklar berättelsen logiskt framåt.",
      "3. Dialog + känslor kopplade till det som faktiskt händer.",
      "4. Tydlig konkret avslutning utan floskler.",
      "",
      "När barnet ber om ett sista kapitel:",
      "- Ge ett tydligt slut som bygger på det som redan hänt.",
      "- Låt hjältens utveckling kännas konsekvent (ingen blir plötsligt sämre igen).",
      "- Lös de viktigaste konflikterna eller frågorna, men börja inte ett nytt äventyr.",
      "",
      "SVARSFORMAT:",
      '{ "chapterText": "...", "storyState": { ... valfri tydlig sammanfattning av läget ... } }'
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
      if (
        apiResponse.choices &&
        apiResponse.choices[0] &&
        apiResponse.choices[0].message &&
        typeof apiResponse.choices[0].message.content === "string"
      ) {
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
    } = opts || {};

    if (!worldState) throw new Error("BNStoryEngine: worldState saknas.");

    const meta = worldState.meta || {};
    const ageBand = determineAgeBand(meta.ageValue || meta.age || "");

    const prompt = buildPrompt({
      worldState,
      storyState,
      chapterIndex,
      ageBand
    });

    const payload = {
      prompt,
      age: meta.ageValue || meta.age,
      hero: meta.hero,
      length: meta.lengthValue || meta.length,
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
      // Tillåt modellen att bära på sin egen sammanfattning,
      // men om den inte skickar något → behåll tidigare storyState.
      newState = json.storyState && typeof json.storyState === "object"
        ? json.storyState
        : storyState;
    } else {
      chapterText = modelText;
      newState = storyState;
    }

    // Trimma till hel mening + ålders-specifik maxlängd
    chapterText = trimToWholeSentence(
      String(chapterText || "").slice(0, ageBand.maxChars)
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
