// =====================================================================
// BN-KIDS — generateStoryWithIPFilter (GC v9)
// Kopplar ihop:
//   1) IP-skydd (sanering av barnets prompt + blockering i output)
//   2) StoryEngine v9 (ålders- & längdstyrd sagomotor)
//   3) Korrekt textleverans till UI:t (ingen JSON-klump, ingen dubbeltext)
//
// Nytt i v9:
//   - Använder BN_STORY_CONFIG (via StoryEngine v9) för att styra ton
//     och längd per åldersband (7–9, 10–12, 13–15).
//   - Förklaringen “Obs! jag kan inte använda riktiga figurer…”
//       → visas ENDAST om barnet faktiskt skrev IP
//       → visas ENDAST i kapitel 1
//   - Utgående text rensas från LEGO, Disney, Marvel osv om BNKidsIP.cleanOutputText finns.
//   - Om modellen lämnar JSON → vi plockar ut chapterText.
//   - Response är alltid enkel och clean.
//
// Exponeras globalt som: window.generateStoryWithIPFilter
// =====================================================================

(function (global) {
  "use strict";

  const BNKidsIP      = global.BNKidsIP || {};
  const BNStoryEngine = global.BNStoryEngine;

  if (!BNStoryEngine || typeof BNStoryEngine.generateChapter !== "function") {
    console.error("generateStory.ip.gc.js: StoryEngine saknas – kontrollera load order.");
  }
  if (!BNKidsIP || typeof BNKidsIP.sanitizePrompt !== "function") {
    console.error("generateStory.ip.gc.js: IP-sanitizer saknas – kontrollera load order.");
  }

  // -----------------------------------------------------------
  // Hjälp: rensa ut JSON-klump om modellen råkar svara så
  // -----------------------------------------------------------
  function extractChapterTextFromPossibleJson(text) {
    if (typeof text !== "string") return text;

    const trimmed = text.trim();
    if (!trimmed.startsWith("{")) return text;
    if (!trimmed.includes("\"chapterText\"")) return text;

    try {
      const j = JSON.parse(trimmed);
      if (j && typeof j.chapterText === "string") return j.chapterText;
    } catch (_) {}

    return text;
  }

  // -----------------------------------------------------------
  // Main wrapper: generateStoryWithIPFilter(prompt, options)
  //
  // options förväntas t.ex. innehålla:
  // {
  //   worldState: {...},       // bokens worldstate (meta, kapitel m.m.)
  //   storyState: {...},       // logik-state mellan kapitel
  //   chapterIndex: 1,         // 1, 2, 3...
  //   apiUrl: "/api/story"     // backend-route, default sätts nedan
  // }
  // -----------------------------------------------------------
  async function generateStoryWithIPFilter(rawPrompt, options) {
    options = options || {};

    if (!BNStoryEngine || typeof BNStoryEngine.generateChapter !== "function") {
      throw new Error("generateStoryWithIPFilter: StoryEngine saknas.");
    }
    if (!BNKidsIP || typeof BNKidsIP.sanitizePrompt !== "function") {
      throw new Error("generateStoryWithIPFilter: IP-sanitizer saknas.");
    }

    const worldState   = options.worldState;
    const storyStateIn = options.storyState || {};
    const chapterIndex = options.chapterIndex || 1;

    if (!worldState) {
      throw new Error("generateStoryWithIPFilter: worldState saknas i options.");
    }

    // -------------------------------------------------------
    // 1) Sanera barnets prompt (IP-skydd på input)
    // -------------------------------------------------------
    const ipSanitized    = BNKidsIP.sanitizePrompt(rawPrompt || "");
    const sanitizedPrompt = ipSanitized.sanitizedPrompt;
    const hadIPInPrompt   = ipSanitized.hadIP;
    const blockedPrompt   = ipSanitized.blockedTerms || [];
    const explanationPref = ipSanitized.explanationPrefix || "";

    // Stoppa in sanerad prompt i worldState så motorn kan ta hänsyn
    const effectiveWorldState = Object.assign({}, worldState, {
      _userPrompt: sanitizedPrompt
    });

    // -------------------------------------------------------
    // 2) Kör BN Story Engine v9
    // -------------------------------------------------------
    const engine = await BNStoryEngine.generateChapter({
      apiUrl: options.apiUrl || "/api/generate_story",
      worldState: effectiveWorldState,
      storyState: storyStateIn,
      chapterIndex: chapterIndex
    });

    let chapterText = engine.chapterText || "";

    // -------------------------------------------------------
    // 3) Om modellen ändå skickat JSON → plocka ut ren text
    // -------------------------------------------------------
    chapterText = extractChapterTextFromPossibleJson(chapterText);

    // -------------------------------------------------------
    // 4) IP-skydd även på utgående text (blockera LEGO etc)
    // -------------------------------------------------------
    let hadIPInOutput = false;
    let blockedOutput = [];

    if (typeof BNKidsIP.cleanOutputText === "function") {
      const cleaned    = BNKidsIP.cleanOutputText(chapterText);
      chapterText      = cleaned.cleanedText || chapterText;
      hadIPInOutput    = !!cleaned.hadIPInOutput;
      blockedOutput    = cleaned.blockedOutputTerms || [];
    }

    const blockedAll = Array.from(new Set([].concat(blockedPrompt, blockedOutput)));

    // -------------------------------------------------------
    // 5) Lägg bara till förklaringen EN GÅNG, i kapitel 1,
    //    och BARA om prompten hade upphovsrättsskyddat IP
    // -------------------------------------------------------
    let finalText = chapterText;
    if (hadIPInPrompt && chapterIndex === 1 && explanationPref) {
      finalText = explanationPref + "\n\n" + chapterText;
    }

    // -------------------------------------------------------
    // 6) Returnera stabilt paket till UI
    // -------------------------------------------------------
    return {
      text: finalText,
      hadIP: (hadIPInOutput || hadIPInPrompt),
      hadIPInPrompt: hadIPInPrompt,
      hadIPInOutput: hadIPInOutput,
      blockedTerms: blockedAll,
      storyState: engine.storyState || storyStateIn,
      engineVersion: engine.engineVersion || "bn-story-engine-v9"
    };
  }

  // -----------------------------------------------------------
  // Exponera globalt
  // -----------------------------------------------------------
  global.generateStoryWithIPFilter = generateStoryWithIPFilter;

})(window);
