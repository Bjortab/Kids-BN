// ===============================================================
// BN-KIDS — STORY ENGINE (GC v8)
// - Håller ordning på kapitel (ingen omstart mitt i boken)
// - Åldersband 7–8, 9–10, 11–12, 13–14, 15 med olika längd/stil
// - Försöker undvika att upprepa exakt samma händelse
// - Trim till hel mening inom max tecken per åldersband
//
// Exponeras som: window.BNStoryEngine.generateChapter(opts)
// ===============================================================
(function (global) {
  "use strict";

  const ENGINE_VERSION = "bn-story-engine-v8";

  // ------------------------------------------------------------
  // Åldersband – olika längd & stil
  // ------------------------------------------------------------
  const AGE_BANDS = {
    "7-8": {
      label: "7–8 år",
      maxChars: 650,
      wordGoal: 100,
      tone:
        "mycket enkel, trygg, konkret, korta meningar, några få detaljer. Fokus på känslor och tydliga händelser."
    },
    "9-10": {
      label: "9–10 år",
      maxChars: 900,
      wordGoal: 150,
      tone:
        "enkel men lite mer äventyrlig, mer dialog och detaljer, ändå tydligt språk utan svåra ord."
    },
    "11-12": {
      label: "11–12 år",
      maxChars: 1200,
      wordGoal: 200,
      tone:
        "vardagsmagi, känslor, vänskap, tydlig logik och orsak–verkan. Lagom med beskrivningar."
    },
    "13-14": {
      label: "13–14 år",
      maxChars: 1500,
      wordGoal: 260,
      tone:
        "mer detaljerad, inre tankar, relationer och konsekvenser. Fortfarande barnvänligt men inte barnsligt."
    },
    "15": {
      label: "15 år",
      maxChars: 1900,
      wordGoal: 320,
      tone:
        "tonårsnivå: mer reflektion, känslor, dilemman och konsekvenser. Ändå positiv, utan rått våld."
    }
  };

  // ------------------------------------------------------------
  // Åldersband utifrån meta.age (kan vara '7-8', '7–8 år', '15' osv)
  // ------------------------------------------------------------
  function determineAgeBand(ageInput) {
    if (!ageInput) return AGE_BANDS["11-12"];

    const str = String(ageInput);
    // Direkt match om vi råkar ha nyckeln
    if (AGE_BANDS[str]) return AGE_BANDS[str];

    // Plocka ut första talet
    const m = str.match(/(\d{1,2})/);
    if (!m) return AGE_BANDS["11-12"];

    const age = parseInt(m[1], 10);

    if (age <= 8) return AGE_BANDS["7-8"];
    if (age <= 10) return AGE_BANDS["9-10"];
    if (age <= 12) return AGE_BANDS["11-12"];
    if (age <= 14) return AGE_BANDS["13-14"];
    return AGE_BANDS["15"];
  }

  // ------------------------------------------------------------
  // Trimma av till sista fullständiga mening
  // ------------------------------------------------------------
  function trimToWholeSentence(text) {
    let t = (text || "").trim();
    if (!t) return "";

    const lastDot = t.lastIndexOf(".");
    const lastExc = t.lastIndexOf("!");
    const lastQ   = t.lastIndexOf("?");

    const last = Math.max(lastDot, lastExc, lastQ);
    if (last === -1) return t;

    return t.slice(0, last + 1);
  }

  // ------------------------------------------------------------
  // Bygg systemprompt till modellen
  // worldState.meta förväntas innehålla åtminstone age/hero/length
  // storyState kan innehålla sammanfattningar / tidigare kapitel
  // ------------------------------------------------------------
  function buildPrompt(opts) {
    const { worldState, storyState, chapterIndex, ageBand } = opts;

    const meta = worldState && worldState.meta ? worldState.meta : {};
    const hero = meta.hero || "hjälten";
    const baseIdea =
      worldState && (worldState.seedPrompt || worldState.prompt || worldState._userPrompt || "");
    const ageLabel = ageBand.label || "11–12 år";

    // Försök hitta tidigare kapitel / sammanfattning i storyState
    const prevSummary =
      (storyState && storyState.summary) ||
      (storyState && storyState.overview) ||
      "";

    const prevChapters =
      (storyState && Array.isArray(storyState.chapters) && storyState.chapters) || [];

    let recapBlock = "";
    if (!prevChapters.length && !prevSummary) {
      recapBlock =
        "Detta är första kapitlet i boken. Inga tidigare kapitel finns ännu. Du ska starta berättelsen.";
    } else {
      const first = prevChapters[0] && (prevChapters[0].text || prevChapters[0].chapterText || "");
      const lastObj = prevChapters[prevChapters.length - 1] || {};
      const last = lastObj.text || lastObj.chapterText || "";

      const cleanFirst = (first || "").replace(/\s+/g, " ").trim();
      const cleanLast = (last || "").replace(/\s+/g, " ").trim();

      const firstShort =
        cleanFirst.length > 260 ? cleanFirst.slice(0, 260) + " …" : cleanFirst;
      const lastShort =
        cleanLast.length > 320 ? "… " + cleanLast.slice(cleanLast.length - 320) : cleanLast;

      recapBlock =
        "Kort recap av berättelsen hittills:\n" +
        (prevSummary ? prevSummary + "\n\n" : "") +
        (firstShort
          ? "Så här började allt:\n" + firstShort + "\n\n"
          : "") +
        (lastShort
          ? "Så här slutade det senaste kapitlet (FORTSÄTT HÄRIFRÅN, inte från början):\n" +
            lastShort
          : "");
    }

    return [
      `Du är BN-KIDS sagomotor (${ENGINE_VERSION}).`,
      "",
      `Skriv KAPITEL ${chapterIndex} för ett barn i åldern ${ageLabel}, cirka ${ageBand.wordGoal} ord.`,
      "",
      "Barnets grundidé med boken (utgå från detta, men hitta inte på nya fakta):",
      baseIdea ? `"${baseIdea}"` : "(ingen särskild idé angiven)",
      "",
      "VIKTIGA KRAV PÅ BERÄTTELSEN:",
      "- Skriv på naturlig, korrekt svenska.",
      "- Håll språket på nivå som passar åldern.",
      "- Följ logiken i berättelsen: det som redan hänt får inte ändras.",
      "- Starta INTE om berättelsen från början. Fortsätt där det senaste kapitlet slutade.",
      "- Upprepa inte exakt samma händelse om barnet ber om samma sak igen (t.ex. 'draken lär sig flyga').",
      "  Visa istället hur händelsen utvecklas vidare, ett nytt steg i samma resa.",
      "- Uppfinn inte nya fakta om karaktärer eller världen som inte går att motivera logiskt.",
      "- Om något behöver få ett namn (t.ex. ett djur) låter du karaktärerna NAMNGE det i scenen.",
      "- Om något magiskt eller ovanligt händer (tunnel med stjärnor, glittrande ljus osv) – förklara kort varför.",
      "",
      "STIL ENLIGT ÅLDER:",
      ageBand.tone,
      "",
      "KONTEXT (WORLDSTATE) – använd men hitta inte på extra fakta:",
      JSON.stringify(worldState || {}, null, 2),
      "",
      "STORYSTATE – hjälpdata om tidigare kapitel (följ kontinuiteten):",
      JSON.stringify(storyState || {}, null, 2),
      "",
      "STRUKTUR FÖR KAPITLET:",
      "1. 1–3 meningar recap som knyter an till förra kapitlet (utan att börja om helt).",
      "2. En tydlig huvudscen som driver berättelsen framåt.",
      "3. Dialog och känslor som passar åldern.",
      "4. Ett konkret slut på kapitlet (hel mening) – gärna en mjuk krok vidare, men ingen cliffhanger mitt i en mening.",
      "",
      "SVARSFORMAT:",
      '{ "chapterText": "...", "storyState": { ... } }',
      "Om du av misstag inte kan hålla JSON-form, skicka bara ren text."
    ].join("\n");
  }

  // ------------------------------------------------------------
  // Hämta text från API-svar (OpenAI/Mistral/egen backend)
  // ------------------------------------------------------------
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
    } catch (e) {
      // Ignorera, vi faller ned till JSON-stringify
    }

    try {
      return JSON.stringify(apiResponse);
    } catch (e) {
      return String(apiResponse);
    }
  }

  // ------------------------------------------------------------
  // Försök plocka ut JSON-klump från modelltext
  // ------------------------------------------------------------
  function extractJson(text) {
    if (!text || typeof text !== "string") return null;
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) return null;

    try {
      return JSON.parse(text.slice(first, last + 1));
    } catch (_) {
      return null;
    }
  }

  // ------------------------------------------------------------
  // API-anrop till backend (/api/generate_story)
  // ------------------------------------------------------------
  async function callApi(apiUrl, payload) {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });

    let raw;
    try {
      raw = await res.json();
    } catch (e) {
      raw = await res.text();
    }
    return raw;
  }

  // ------------------------------------------------------------
  // HUVUD: generateChapter(opts)
  //
  // opts:
  //   - apiUrl      (default "/api/generate_story")
  //   - worldState  (krav)
  //   - storyState  (optional, objekt vi skickar fram-och-tillbaka)
  //   - chapterIndex (1,2,3...)
  // ------------------------------------------------------------
  async function generateChapter(opts) {
    const {
      apiUrl = "/api/generate_story",
      worldState,
      storyState = {},
      chapterIndex = 1
    } = opts || {};

    if (!worldState) {
      throw new Error("BNStoryEngine: worldState saknas.");
    }

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

    if (json && typeof json.chapterText === "string") {
      chapterText = json.chapterText;
      newState = json.storyState || storyState;
    } else {
      chapterText = modelText;
      newState = storyState;
    }

    // Trimma längd + se till att sluta med hel mening
    const bandMax = ageBand.maxChars || 1200;
    chapterText = trimToWholeSentence(
      (chapterText || "").slice(0, bandMax)
    );

    return {
      chapterText,
      storyState: newState,
      engineVersion: ENGINE_VERSION,
      ageBand
    };
  }

  // ------------------------------------------------------------
  // Exportera global motor
  // ------------------------------------------------------------
  global.BNStoryEngine = {
    generateChapter,
    ENGINE_VERSION
  };
})(window);
