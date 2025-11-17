// ==========================================================
// BN-KIDS — generateStory IP WRAPPER + STORY ENGINE (v2)
// - IP-skydd + kapitelmotor i samma pipeline
// - Använder:
//     - BNKidsIP.sanitizePrompt(prompt)
//     - BNStoryEngine.generateChapter(options)
//
// Exponerar globalt:
//    - generateStoryWithIPFilter(rawPrompt, options?)
//      → {
//           text,          // färdigt kapitel (ev. med förklaring först)
//           hadIP,         // true/false
//           blockedTerms,  // ["pippi långstrump", ...]
//           storyState,    // uppdaterad röd tråd
//           chapterPlan,   // kapitelplan
//           engineVersion  // BN Story Engine version
//         }
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

    // 1) IP-skydd + sanering
    const sanitizedResult = BNKidsIP.sanitizePrompt(raw);
    const sanitizedPrompt = sanitizedResult.sanitizedPrompt;
    const hadIP           = sanitizedResult.hadIP;
    const blockedTerms    = sanitizedResult.blockedTerms;
    const explanationPref = sanitizedResult.explanationPrefix;

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

    const engineResult = await BNStoryEngine.generateChapter({
      apiUrl: options.apiUrl || "/api/story",
      worldState: effectiveWorldState,
      storyState: storyStateIn,
      chapterIndex: chapterIndex,
      maxChars: options.maxChars || 1600,
      language: options.language || "sv",
      audience: options.audience || "7-12",
      styleHints: options.styleHints || []
    });

    let finalText = engineResult.chapterText || "";

    // 3) Lägg på förklaringen om barnet använde IP
    if (hadIP && explanationPref) {
      finalText = explanationPref + "\n\n" + finalText;
    }

    return {
      text: finalText,
      hadIP: hadIP,
      blockedTerms: blockedTerms,
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
