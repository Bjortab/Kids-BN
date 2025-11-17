// ==========================================================
// BN-KIDS — STORY ENGINE DEV (v2)
// - Bygger kapitel ovanpå befintligt /api/generate_story
// - Försöker läsa JSON { chapterPlan, chapterText, storyState }
// - Om ingen JSON hittas → använder hela svaret som kapiteltext
//   och behåller storyState som det är.
// ==========================================================
(function (global) {
  "use strict";

  const ENGINE_VERSION = "bn-story-engine-v2";

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
      audience = "7-12",
      styleHints = []
    } = options;

    const wsJson = safeJson(worldState);
    const ssJson = safeJson(storyState || {});

    const styleText = styleHints.length
      ? styleHints.map(function (s, i) { return (i + 1) + ". " + s; }).join("\n")
      : "- Levande, konkret, mycket dialog.\n- Enkla meningar men inte bebisspråk.";

    const langText =
      language === "sv"
        ? "Skriv på tydlig, naturlig svenska."
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
    const maxChars     = options.maxChars || 1600;
    const language     = options.language || "sv";
    const audience     = options.audience || "7-12";
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

    const prompt = buildEnginePrompt({
      worldState,
      storyState: storyStateIn,
      chapterIndex,
      language,
      audience,
      styleHints
    });

    const meta = (worldState && worldState.meta) || {};

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

    chapterText = truncateToWholeSentence(chapterText, maxChars);

    return {
      chapterText: chapterText,
      storyState: updatedStoryState,
      chapterPlan: chapterPlan,
      rawModelText: modelText,
      engineVersion: ENGINE_VERSION
    };
  }

  // ----------------------------------------------------------
  // Exponera mot global scope
  // ----------------------------------------------------------
  const BNStoryEngine = {
    ENGINE_VERSION: ENGINE_VERSION,
    generateChapter: generateChapter,
    truncateToWholeSentence: truncateToWholeSentence
  };

  global.BNStoryEngine = BNStoryEngine;
})(window);
