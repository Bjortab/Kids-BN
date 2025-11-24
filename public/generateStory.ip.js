// =====================================================================
// BN-KIDS — generateStoryWithIPFilter (DEV v10.3)
// ---------------------------------------------------------------------
// Kopplar ihop:
//   1) IP-skydd (sanering av prompt + blockering av IP i output)
//   2) StoryEngine v10.3 (ny "BN-författare"-stil + FocusLock)
//   3) Ren text till UI:t (ingen JSON, ingen dubbel-saga)
//
// Viktigt i v10.3:
//   - Förklaringen “Obs! jag kan inte använda riktiga figurer…”
//       → visas ENDAST om barnet faktiskt skrev IP
//       → visas ENDAST i kapitel 1
//   - Utgående text rensas från LEGO, Disney, Marvel osv via cleanOutputText
//   - Motorn förväntar sig REN kapiteltext (ingen JSON), vi hanterar ändå
//     JSON-fall defensivt ifall modellen trots allt svarar konstigt.
//   - worldState._userPrompt matas in till StoryEngine, så FLE/fokus följer
//     barnets senaste önskan.
//
// Exponeras globalt som: window.generateStoryWithIPFilter
// =====================================================================

(function (global) {
  "use strict";

  const BNKidsIP      = global.BNKidsIP || {};
  const BNStoryEngine = global.BNStoryEngine;

  if (!BNStoryEngine || typeof BNStoryEngine.generateChapter !== "function") {
    console.error(
      "[BN-KIDS] generateStory.ip.js: StoryEngine saknas – kontrollera load order (story_engine.dev.js måste laddas före denna fil)."
    );
  }
  if (!BNKidsIP || typeof BNKidsIP.sanitizePrompt !== "function") {
    console.error(
      "[BN-KIDS] generateStory.ip.js: IP-sanitizer saknas – kontrollera att ip_sanitizer.js laddas före denna fil."
    );
  }

  // -----------------------------------------------------------
  // Hjälp: rensa ut JSON-klump om modellen råkar svara så
  // (v10.3 ber modellen skriva ren text, men vi är defensiva)
  // -----------------------------------------------------------
  function extractChapterTextFromPossibleJson(text) {
    if (typeof text !== "string") return text;

    const trimmed = text.trim();
    if (!trimmed.startsWith("{")) return text;
    if (!trimmed.includes("\"chapterText\"")) return text;

    try {
      const j = JSON.parse(trimmed);
      if (j && typeof j.chapterText === "string") return j.chapterText;
    } catch (_) {
      // ignorera JSON-fel, använd originaltext
    }

    return text;
  }

  // -----------------------------------------------------------
  // Main wrapper: generateStoryWithIPFilter(prompt, options)
  // -----------------------------------------------------------
  async function generateStoryWithIPFilter(rawPrompt, options) {
    options = options || {};

    if (!BNStoryEngine || typeof BNStoryEngine.generateChapter !== "function") {
      throw new Error("generateStoryWithIPFilter: StoryEngine saknas.");
    }
    if (!BNKidsIP || typeof BNKidsIP.sanitizePrompt !== "function") {
      throw new Error("generateStoryWithIPFilter: IP-sanitizer saknas.");
    }

    const worldState    = options.worldState;
    const storyStateIn  = options.storyState || {};
    const chapterIndex  = options.chapterIndex || 1;
    const apiUrl        = options.apiUrl || "/api/generate_story";

    if (!worldState) {
      throw new Error(
        "generateStoryWithIPFilter: worldState saknas i options. (" +
          "Skicka in worldState från WS_DEV eller motsvarande.)"
      );
    }

    // -------------------------------------------------------
    // 1) Sanera barnets prompt (IP-skydd, upphovsrätt)
    // -------------------------------------------------------
    const ipSanitized = BNKidsIP.sanitizePrompt(rawPrompt || "");
    const sanitizedPrompt = ipSanitized.sanitizedPrompt;
    const hadIPInPrompt   = !!ipSanitized.hadIP;
    const blockedPrompt   = ipSanitized.blockedTerms || [];
    const explanationPref = ipSanitized.explanationPrefix || "";

    // Lägg in den sanerade prompten i worldState, så att StoryEngine (v10.3)
    // kan använda den i sin Focus Lock / FLE.
    const effectiveWorldState = Object.assign({}, worldState, {
      _userPrompt: sanitizedPrompt
    });

    // -------------------------------------------------------
    // 2) Kör BN Story Engine v10.3
    // -------------------------------------------------------
    const engine = await BNStoryEngine.generateChapter({
      apiUrl: apiUrl,
      worldState: effectiveWorldState,
      storyState: storyStateIn,
      chapterIndex: chapterIndex
    });

    let chapterText = engine.chapterText || "";

    // Om modellen trots allt försöker returnera JSON → plocka ut chapterText
    chapterText = extractChapterTextFromPossibleJson(chapterText);

    // -------------------------------------------------------
    // 3) IP-skydd även på utgående text (blockera LEGO etc)
    // -------------------------------------------------------
    let hadIPInOutput = false;
    let blockedOutput = [];

    if (typeof BNKidsIP.cleanOutputText === "function") {
      try {
        const cleaned = BNKidsIP.cleanOutputText(chapterText);
        if (cleaned && typeof cleaned.cleanedText === "string") {
          chapterText = cleaned.cleanedText;
        }
        hadIPInOutput = !!cleaned.hadIPInOutput;
        blockedOutput = cleaned.blockedOutputTerms || [];
      } catch (e) {
        console.warn("[BN-KIDS] cleanOutputText kastade fel:", e);
      }
    }

    const blockedAll = Array.from(
      new Set([].concat(blockedPrompt, blockedOutput))
    );

    // -------------------------------------------------------
    // 4) Lägg bara till IP-förklaringen EN GÅNG, i kapitel 1,
    //    och BARA om prompten hade upphovsrättsskyddat IP
    // -------------------------------------------------------
    let finalText = chapterText;
    if (hadIPInPrompt && chapterIndex === 1 && explanationPref) {
      finalText = explanationPref + "\n\n" + chapterText;
    }

    // -------------------------------------------------------
    // 5) Returnera stabilt paket till UI
    //    (samma struktur som tidigare versioner)
    // -------------------------------------------------------
    return {
      text: finalText,
      hadIP: hadIPInOutput || hadIPInPrompt,
      hadIPInPrompt: hadIPInPrompt,
      hadIPInOutput: hadIPInOutput,
      blockedTerms: blockedAll,
      storyState: engine.storyState || storyStateIn,
      engineVersion: engine.engineVersion || "bn-story-engine-v10_3",
      ageBand: engine.ageBand || null
    };
  }

  // -----------------------------------------------------------
  // Exponera globalt
  // -----------------------------------------------------------
  global.generateStoryWithIPFilter = generateStoryWithIPFilter;
})(window);
