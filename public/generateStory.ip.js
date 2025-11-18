// =====================================================================
// BN-KIDS — generateStoryWithIPFilter (GC v8)
// ---------------------------------------------------------------------
// Kopplar ihop:
//   1) IP-skydd (sanering av prompt + blockering i output)
//   2) StoryEngine v8 (kapitelmotor med åldersband)
//   3) Returnerar ren text till UI:t (ingen rå JSON-klump, ingen dubbel-saga)
//
// Viktigt i v8:
//   - Förklaringen “Obs! jag kan inte använda riktiga figurer…”
//       → visas ENDAST om barnet faktiskt skrev IP
//       → visas ENDAST i kapitel 1
//   - Utgående text IP-rensas (LEGO, Disney, Marvel etc tas bort)
//   - Om modellen råkar lämna JSON → vi plockar ut chapterText
//   - Alltid EN saga i svaret (request-lock sköts i ws_button.dev.js)
// ---------------------------------------------------------------------
// Exponeras globalt som: window.generateStoryWithIPFilter(prompt, options)
// =====================================================================
(function (global) {
  "use strict";

  const BNKidsIP = global.BNKidsIP || {};
  const BNStoryEngine = global.BNStoryEngine;

  if (!BNStoryEngine || typeof BNStoryEngine.generateChapter !== "function") {
    console.error(
      "generateStory.ip.js (GC v8): StoryEngine saknas – kontrollera att story_engine.dev.js laddas före denna fil."
    );
  }
  if (!BNKidsIP || typeof BNKidsIP.sanitizePrompt !== "function") {
    console.error(
      "generateStory.ip.js (GC v8): IP-sanitizer saknas – kontrollera ip_blocklist.js / ip_sanitizer.js."
    );
  }

  // -----------------------------------------------------------
  // Hjälp: om modellen råkar skicka en JSON-klump istället för ren text
  // -----------------------------------------------------------
  function extractChapterTextFromPossibleJson(text) {
    if (typeof text !== "string") return text;

    const trimmed = text.trim();
    if (!trimmed.startsWith("{")) return text;
    if (!trimmed.includes('"chapterText"')) return text;

    try {
      const j = JSON.parse(trimmed);
      if (j && typeof j.chapterText === "string") return j.chapterText;
    } catch (_) {
      // fall back till original text
    }

    return text;
  }

  // -----------------------------------------------------------
  // Main wrapper: generateStoryWithIPFilter(rawPrompt, options)
  //
  // options:
  //   - worldState   (krav)
  //   - storyState   (objekt som skickas vidare mellan kapitel)
  //   - chapterIndex (1,2,3...)
  //   - apiUrl       (default "/api/generate_story")
  //   - maxChars, language, audience (ev. framtid, ignoreras här)
  // -----------------------------------------------------------
  async function generateStoryWithIPFilter(rawPrompt, options) {
    options = options || {};

    if (!BNStoryEngine || typeof BNStoryEngine.generateChapter !== "function") {
      throw new Error("generateStoryWithIPFilter: StoryEngine saknas.");
    }
    if (!BNKidsIP || typeof BNKidsIP.sanitizePrompt !== "function") {
      throw new Error("generateStoryWithIPFilter: IP-sanitizer saknas.");
    }

    const worldState = options.worldState;
    const storyStateIn = options.storyState || {};
    const chapterIndex = options.chapterIndex || 1;

    if (!worldState) {
      throw new Error("generateStoryWithIPFilter: worldState saknas i options.");
    }

    // -------------------------------------------------------
    // 1) IP-skydd på barnets prompt
    // -------------------------------------------------------
    const ipSanitized = BNKidsIP.sanitizePrompt(rawPrompt || "");
    const sanitizedPrompt = ipSanitized.sanitizedPrompt;
    const hadIPInPrompt = ipSanitized.hadIP;
    const blockedPrompt = ipSanitized.blockedTerms || [];
    const explanationPref = ipSanitized.explanationPrefix || "";

    // Lägg in den sanerade prompten i worldState under hjälpfält
    const effectiveWorldState = Object.assign({}, worldState, {
      _userPrompt: sanitizedPrompt
    });

    // -------------------------------------------------------
    // 2) Kör StoryEngine v8
    // -------------------------------------------------------
    const engine = await BNStoryEngine.generateChapter({
      apiUrl: options.apiUrl || "/api/generate_story",
      worldState: effectiveWorldState,
      storyState: storyStateIn,
      chapterIndex: chapterIndex
    });

    let chapterText = engine.chapterText || "";

    // -------------------------------------------------------
    // 3) Om modellen råkar returnera JSON-string → plocka ut chapterText
    // -------------------------------------------------------
    chapterText = extractChapterTextFromPossibleJson(chapterText);

    // -------------------------------------------------------
    // 4) IP-skydd även på utgående text (blockera LEGO etc)
    // -------------------------------------------------------
    let hadIPInOutput = false;
    let blockedOutput = [];

    if (typeof BNKidsIP.cleanOutputText === "function") {
      const cleaned = BNKidsIP.cleanOutputText(chapterText);
      chapterText = cleaned.cleanedText || chapterText;
      hadIPInOutput = !!cleaned.hadIPInOutput;
      blockedOutput = cleaned.blockedOutputTerms || [];
    }

    const blockedAll = Array.from(
      new Set([].concat(blockedPrompt, blockedOutput))
    );

    // -------------------------------------------------------
    // 5) Lägg till förklaring ENDAST:
    //    - om prompten innehöll IP
    //    - om det är kapitel 1
    // -------------------------------------------------------
    let finalText = chapterText;
    if (hadIPInPrompt && chapterIndex === 1 && explanationPref) {
      finalText = explanationPref + "\n\n" + chapterText;
    }

    // -------------------------------------------------------
    // 6) Returnera stabilt paket
    // -------------------------------------------------------
    return {
      text: finalText,
      hadIP: hadIPInOutput || hadIPInPrompt,
      hadIPInPrompt,
      hadIPInOutput,
      blockedTerms: blockedAll,
      storyState: engine.storyState || storyStateIn,
      engineVersion: engine.engineVersion || "bn-story-engine-v8"
    };
  }

  // -----------------------------------------------------------
  // Exponera globalt
  // -----------------------------------------------------------
  global.generateStoryWithIPFilter = generateStoryWithIPFilter;
})(window);
