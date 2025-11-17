// ==========================================================
// BN-KIDS — generateStory IP WRAPPER + STORY ENGINE (v4)
// - IP-skydd + kapitelmotor i samma pipeline
// - Rensar både PROMPT och UTGÅENDE TEXT från IP (t.ex. LEGO)
// - "Obs! Jag kan inte använda riktiga sagokaraktärer…":
//    * visas bara om barnets prompt innehöll IP
//    * och bara i första kapitlet (chapterIndex === 1)
// ==========================================================
(function (global) {
  "use strict";

  const BNKidsIP      = global.BNKidsIP || {};
  const BNStoryEngine = global.BNStoryEngine;

  if (!BNStoryEngine || typeof BNStoryEngine.generateChapter !== "function") {
    console.error(
      "BN-KIDS generateStory.ip.js: BNStoryEngine.generateChapter saknas. " +
      "Kontrollera att story_engine.dev.js laddas före generateStory.ip.js."
    );
  }

  if (!BNKidsIP || typeof BNKidsIP.sanitizePrompt !== "function") {
    console.error(
      "BN-KIDS generateStory.ip.js: BNKidsIP.sanitizePrompt saknas. " +
      "Kontrollera att ip_blocklist.js och ip_sanitizer.js laddas före generateStory.ip.js."
    );
  }

  function uniqueArray(arr) {
    return Array.from(new Set(arr.filter(Boolean)));
  }

  // --------------------------------------------------------
  // generateStoryWithIPFilter(rawPrompt, options?)
  // --------------------------------------------------------
  async function generateStoryWithIPFilter(rawPrompt, options) {
    options = options || {};

    if (!BNStoryEngine || typeof BNStoryEngine.generateChapter !== "function") {
      throw new Error(
        "generateStoryWithIPFilter: BNStoryEngine.generateChapter saknas. " +
        "Se till att story_engine.dev.js laddas före generateStory.ip.js."
      );
    }

    if (!BNKidsIP || typeof BNKidsIP.sanitizePrompt !== "function") {
      throw new Error(
        "generateStoryWithIPFilter: BNKidsIP.sanitizePrompt saknas. " +
        "Kontrollera att ip_blocklist.js och ip_sanitizer.js laddas före generateStory.ip.js."
      );
    }

    const raw = rawPrompt || "";

    // 1) IP-skydd + sanering av PROMPT
    const sanitizedResult = BNKidsIP.sanitizePrompt(raw);
    const sanitizedPrompt = sanitizedResult.sanitizedPrompt;
    const hadIPInPrompt   = !!sanitizedResult.hadIP;
    const blockedPrompt   = sanitizedResult.blockedTerms || [];
    const explanationPref = sanitizedResult.explanationPrefix || "";

    // 2) WorldState + StoryState
    const ws = options.worldState;
    if (!ws) {
      throw new Error(
        "generateStoryWithIPFilter: options.worldState saknas. " +
        "Skicka in ditt worldstate-objekt i anropet."
      );
    }

    const storyStateIn = options.storyState || {};
    const chapterIndex = (typeof options.chapterIndex === "number")
      ? options.chapterIndex
      : 1;

    // Lägg in sanerade prompten som extra signal i worldState
    const effectiveWorldState = Object.assign({}, ws, {
      _userPrompt: sanitizedPrompt
    });

    // 3) Kör BN Story Engine
    const engineResult = await BNStoryEngine.generateChapter({
      apiUrl: options.apiUrl || "/api/generate_story",
      worldState: effectiveWorldState,
      storyState: storyStateIn,
      chapterIndex: chapterIndex,
      maxChars: options.maxChars || 1600,
      language: options.language || "sv",
      audience: options.audience || "7-12",
      styleHints: options.styleHints || []
    });

    let chapterText = engineResult.chapterText || "";

    // 4) IP-skydd på UTGÅENDE TEXT (modellens svar)
    let hadIPInOutput = false;
    let blockedOutput = [];
    if (BNKidsIP.cleanOutputText) {
      const out = BNKidsIP.cleanOutputText(chapterText);
      chapterText   = out.cleanedText || chapterText;
      hadIPInOutput = !!out.hadIPInOutput;
      blockedOutput = out.blockedOutputTerms || [];
    }

    const hadIPTotal = hadIPInPrompt || hadIPInOutput;
    const blockedAll = uniqueArray([].concat(blockedPrompt, blockedOutput));

    // 5) Lägg på förklaringen ENDAST om prompten hade IP + första kapitlet
    let finalText = chapterText;
    if (hadIPInPrompt && explanationPref && chapterIndex === 1) {
      finalText = explanationPref + "\n\n" + chapterText;
    }

    return {
      text: finalText,
      hadIP: hadIPTotal,
      hadIPInPrompt: hadIPInPrompt,
      hadIPInOutput: hadIPInOutput,
      blockedTerms: blockedAll,
      storyState: engineResult.storyState,
      chapterPlan: engineResult.chapterPlan,
      engineVersion: engineResult.engineVersion
    };
  }

  // --------------------------------------------------------
  // Exponera globalt
  // --------------------------------------------------------
  global.generateStoryWithIPFilter = generateStoryWithIPFilter;
})(window);
