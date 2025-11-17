// ==========================================================
// BN-KIDS — STORY ENGINE DEV (v4)
// - Bygger kapitel ovanpå befintligt /api/generate_story
// - Försöker läsa JSON { chapterPlan, chapterText, storyState }
// - Om ingen JSON hittas → använder hela svaret som kapiteltext
// - Extra fokus på:
//   * Naturlig, korrekt svenska
//   * Inga konstiga logikhål (t.ex. stjärnor i en tunnel utan förklaring)
//   * Olika kapitel-längder beroende på ålder:
//       7–8  → kortare kapitel
//       9–10 → lite längre
//       11–12 → medel
//       13–14 → längre
//       15   → längst
// ==========================================================
(function (global) {
  "use strict";

  const ENGINE_VERSION = "bn-story-engine-v4";

  // ----------------------------------------------------------
  // Åldersband & max längd per kapitel
  // ----------------------------------------------------------
  function classifyAgeBand(ageRaw, fallbackAudience) {
    let s = "";

    if (ageRaw !== undefined && ageRaw !== null) {
      s = String(ageRaw).trim();
    } else if (fallbackAudience) {
      s = String(fallbackAudience).trim();
    }

    let a = null;
    let b = null;

    if (!s) {
      // Default: mellanålder
      return {
        band: "11-12",
        display: "11–12",
        maxChars: 1200
      };
    }

    // Försök tolka format som "7-8" eller "9–10"
    let m = s.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
    if (m) {
      a = parseInt(m[1], 10);
      b = parseInt(m[2], 10);
    } else {
      // Annars: plocka första talet i strängen (t.ex. "7 år", "ålder 10")
      let n = s.match(/(\d{1,2})/);
      if (n) {
        a = parseInt(n[1], 10);
        b = a;
      }
    }

    if (a === null || isNaN(a)) {
      return {
        band: "11-12",
        display: "11–12",
        maxChars: 1200
      };
    }

    if (b === null || isNaN(b)) {
      b = a;
    }

    const avg = (a + b) / 2;

    if (avg <= 8) {
      return {
        band: "7-8",
        display: "7–8",
        maxChars: 700
      };
    }
    if (avg <= 10) {
      return {
        band: "9-10",
        display: "9–10",
        maxChars: 900
      };
    }
    if (avg <= 12) {
      return {
        band: "11-12",
        display: "11–12",
        maxChars: 1200
      };
    }
    if (avg <= 14) {
      return {
        band: "13-14",
        display: "13–14",
        maxChars: 1500
      };
    }

    // 15+ → tonåring
    return {
      band: "15",
      display: "15",
      maxChars: 1700
    };
  }

  // ----------------------------------------------------------
  // Hjälpfunktion: försök klippa texten vid sista fullständiga
  // meningen före maxChars.
  // ----------------------------------------------------------
  function truncateToWholeSentence(text, maxChars) {
    if (!text || typeof text !== "string") return "";

    let trimmed = text.trim();

    if (!maxChars || trimmed.length <= maxChars) {
      return _trimUnfinishedSentence(trimmed);
    }

    const slice = trimmed.slice(0, maxChars);

    const lastDot = slice.lastIndexOf(".");
    const lastQ   = slice.lastIndexOf("?");
    const lastEx  = slice.lastIndexOf("!");

    const lastPunctuation = Math.max(lastDot, lastQ, lastEx);

    if (lastPunctuation === -1) {
      return _trimUnfinishedSentence(slice);
    }

    const candidate = slice.slice(0, lastPunctuation + 1);
    return _trimUnfinishedSentence(candidate);
  }

  function _trimUnfinishedSentence(text) {
    let t = text.trim();

    // Ta bort avslutande kommatecken / kolon / semikolon
    t = t.replace(/[,:;]\s*$/u, "");

    const parts = t.split(/\s+/u);
    if (!parts.length) return t;

    const last = parts[parts.length - 1];
    if (/-$/.test(last)) {
      parts.pop();
      t = parts.join(" ");
    }

    return t.trim();
  }

  // ----------------------------------------------------------
  // Bygg prompt till modellen.
  // ----------------------------------------------------------
  function buildEnginePrompt(options) {
    const {
      worldState,
      storyState,
      chapterIndex,
      language = "sv",
      audience = "7–12",   // display-text, t.ex. "7–8"
      styleHints = []
    } = options;

    const wsJson = safeJson(worldState);
    const ssJson = safeJson(storyState || {});

    const styleText = styleHints.length
      ? styleHints.map(function (s, i) { return (i + 1) + ". " + s; }).join("\n")
      : [
          "- Skriv som en skicklig svensk barnboksförfattare.",
          "- Naturlig, korrekt svenska med bra flyt och tydlig grammatik.",
          "- Enkla meningar som är lätta att läsa högt, men inte bebisspråk.",
          "- Mycket konkret handling, dialog och känslor.",
          "- Undvik svengelska och konstiga, maskinella formuleringar."
        ].join("\n");

    const langText =
      language === "sv"
        ? "Skriv på naturlig, korrekt svenska som låter som en mänsklig författare."
        : "Write in clear, natural language.";

    const continueRule = [
      "- Om det inte uttryckligen står att boken ska avslutas i worldState eller storyState,",
      "  ska du utgå från att berättelsen fortsätter i senare kapitel.",
      "- Avsluta INTE boken här om du inte blir direkt instruerad att göra det.",
      "- Undvik klichéer som:",
      "  - \"nu förstod han/hon att äventyret bara hade börjat\"",
      "  - \"vad kommer att hända härnäst?\"",
      "  - \"detta var bara början\"",
      "  - \"fortsättning följer\"",
      "  och liknande floskler.",
      "- Avsluta i stället kapitlet med en konkret, levande scen eller oväntad detalj",
      "  som gör läsaren nyfiken på nästa kapitel (en naturlig cliffhanger)."
    ].join("\n");

    const logicRule = [
      "- Undvik logiska glapp. Om något ovanligt händer (t.ex. stjärnor som lyser i en tunnel,",
      "  magiskt ljus, märkliga väsen) måste du förklara HUR och VARFÖR det är möjligt i berättelsen.",
      "- Exempel: magiska kristaller som lyser, lampor som satts upp, projektioner från en maskin,",
      "  eller annan enkel, barnvänlig förklaring.",
      "- Skriv aldrig att något bara \"händer\" utan att ge en kort, tydlig orsak i berättelsen.",
      "- Håll dig till en tydlig huvudscen i kapitlet. Blanda inte in slumpmässiga nya element",
      "  som inte hänger ihop med resten av kapitlet."
    ].join("\n");

    return [
      "Du är en specialiserad sagomotor för BN-KIDS kapitelböcker (" + ENGINE_VERSION + ").",
      "",
      "Målgrupp: barn " + audience + " år.",
      langText,
      "",
      "Berättelsen:",
      "- Bygger på worldState (hjältar, plats, önskningar, ton).",
      "- Bygger vidare på storyState (tidigare händelser, konflikter, sidofigurer).",
      "- Du skriver kapitel nummer " + chapterIndex + " i en pågående kapitelbok.",
      "",
      "Berättarstil:",
      styleText,
      "",
      "Regler för fortsättning:",
      continueRule,
      "",
      "Regler för logik och konsekvens:",
      logicRule,
      "",
      "Struktur:",
      "1. Om du kan: skapa först en kort kapitelplan (\"chapterPlan\") med 3–7 punkter.",
      "2. Skriv sedan \"chapterText\" utifrån planen.",
      "   - Kapitlet ska kännas komplett, men lämna plats för fortsättning.",
      "   - Använd tydliga meningar, med fokus på handling, dialog och känslor.",
      "3. Uppdatera \"storyState\" så att det går att fortsätta berättelsen i nästa kapitel.",
      "   - Lägg till nya viktiga figurer eller föremål.",
      "   - Uppdatera konflikter, mål och hemligheter.",
      "",
      "worldState (input, ändra inte själva strukturen, men använd innehållet):",
      wsJson,
      "",
      "storyState (input, du får uppdatera och utöka innehållet):",
      ssJson,
      "",
      "VIKTIGT:",
      "- Om du svarar i JSON-form, använd formatet:",
      "{",
      "  \"chapterPlan\": [\"kort punkt 1\", \"kort punkt 2\", \"...\"],",
      "  \"chapterText\": \"själva kapitlet som löpande text...\",",
      "  \"storyState\": { \"nyckel\": \"värde\", \"...\" : \"...\" }",
      "}",
      "- Om du *inte* svarar i JSON-form går det också bra: skriv då bara kapiteltexten.",
      "- Svara aldrig med annan metadata runtomkring (inga förklaringar före eller efter)."
    ].join("\n");
  }

  function safeJson(obj) {
    try {
      return JSON.stringify(obj || {}, null, 2);
    } catch (e) {
      return "{}";
    }
  }

  // ----------------------------------------------------------
  // Hämta text ur API-svar
  // ----------------------------------------------------------
  function extractModelText(data) {
    if (data == null) return "";

    if (typeof data === "string") return data;

    if (typeof data.text === "string") return data.text;
    if (typeof data.story === "string") return data.story;
    if (typeof data.content === "string") return data.content;

    try {
      if (
        Array.isArray(data.choices) &&
        data.choices[0] &&
        data.choices[0].message &&
        typeof data.choices[0].message.content === "string"
      ) {
        return data.choices[0].message.content;
      }
    } catch (e) {
      // ignore
    }

    try {
      return JSON.stringify(data);
    } catch (e) {
      return "";
    }
  }

  function extractJsonFromText(text) {
    if (!text || typeof text !== "string") return null;

    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) return null;

    const candidate = text.slice(first, last + 1);

    try {
      return JSON.parse(candidate);
    } catch (e) {
      return null;
    }
  }

  // ----------------------------------------------------------
  // Litet fetch-lager – riktas mot /api/generate_story
  // ----------------------------------------------------------
  async function callStoryApi(apiUrl, payload) {
    const url = apiUrl || "/api/generate_story";

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const text = await res.text().catch(function () { return ""; });
      throw new Error(
        "BNStoryEngine: API-svar " + res.status + " " + res.statusText + " — " + text
      );
    }

    try {
      return await res.json();
    } catch (e) {
      const txt = await res.text().catch(function () { return ""; });
      return { text: txt };
    }
  }

  // ----------------------------------------------------------
  // Huvudfunktion: generateChapter(options)
  // ----------------------------------------------------------
  async function generateChapter(options) {
    options = options || {};

    const worldState   = options.worldState;
    const storyStateIn = options.storyState || {};
    const chapterIndex = options.chapterIndex;
    const maxCharsOpt  = options.maxChars || 1600;
    const language     = options.language || "sv";
    const audienceOpt  = options.audience || "7-12";
    const styleHints   = options.styleHints || [];
    const apiUrl       = options.apiUrl || "/api/generate_story";

    if (!worldState) {
      throw new Error("BNStoryEngine.generateChapter: worldState saknas.");
    }
    if (typeof chapterIndex !== "number") {
      throw new Error(
        "BNStoryEngine.generateChapter: chapterIndex måste vara ett nummer."
      );
    }

    const meta    = (worldState && worldState.meta) || {};
    const ageInfo = classifyAgeBand(meta.age, audienceOpt);

    const prompt = buildEnginePrompt({
      worldState,
      storyState: storyStateIn,
      chapterIndex,
      language,
      audience: ageInfo.display,
      styleHints
    });

    const payload = {
      // gamla fält som /api/generate_story förväntar sig
      age: meta.age,
      hero: meta.hero,
      length: meta.length,
      lang: language || "sv",
      // vår riktiga superprompt
      prompt: prompt,
      // extra meta som backend kan ignorera
      engineVersion: ENGINE_VERSION,
      mode: "bn_story_engine",
      chapterIndex: chapterIndex,
      worldState: worldState,
      storyState: storyStateIn
    };

    const rawResponse = await callStoryApi(apiUrl, payload);
    const modelText   = extractModelText(rawResponse);

    // Först: försök tolka JSON-svar
    const json = extractJsonFromText(modelText);

    let chapterText;
    let updatedStoryState;
    let chapterPlan;

    if (json && typeof json === "object") {
      // "riktigt" story-engine-svar
      chapterText = (typeof json.chapterText === "string") ? json.chapterText : "";
      updatedStoryState = json.storyState || storyStateIn || {};
      chapterPlan = Array.isArray(json.chapterPlan) ? json.chapterPlan : [];
    } else {
      // fallback: använd hela svaret som kapiteltext
      chapterText = modelText || "";
      updatedStoryState = storyStateIn || {};
      chapterPlan = [];
    }

    // Åldersstyrd max-längd
    const effectiveMaxChars = Math.min(maxCharsOpt, ageInfo.maxChars);
    chapterText = truncateToWholeSentence(chapterText, effectiveMaxChars);

    return {
      chapterText: chapterText,
      storyState: updatedStoryState,
      chapterPlan: chapterPlan,
      rawModelText: modelText,
      engineVersion: ENGINE_VERSION,
      ageBand: ageInfo.band,
      ageDisplay: ageInfo.display,
      maxCharsUsed: effectiveMaxChars
    };
  }

  // ----------------------------------------------------------
  // Exponera mot global scope
  // ----------------------------------------------------------
  const BNStoryEngine = {
    ENGINE_VERSION: ENGINE_VERSION,
    generateChapter: generateChapter,
    truncateToWholeSentence: truncateToWholeSentence,
    classifyAgeBand: classifyAgeBand
  };

  global.BNStoryEngine = BNStoryEngine;
})(window);
