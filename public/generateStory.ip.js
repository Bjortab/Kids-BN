// =====================================================================
// BN-KIDS — generateStoryWithIPFilter (GC v10.3)
// ---------------------------------------------------------------------
// Kopplar ihop:
//   1) IP-skydd (sanering av prompt + blockering av IP i output)
//   2) StoryEngine v10.3 (stabil kapitelmotor med röd tråd)
//   3) Korrekt textleverans till UI:t (ingen JSON-klump, ingen dubbeltext)
//
// Nycklar i v10.3:
//   - Förklaringen “Obs! jag kan inte använda riktiga figurer…”
//       → visas ENDAST om barnet faktiskt skrev IP
//       → visas ENDAST i kapitel 1
//   - Utgående text rensas från LEGO, Disney, Marvel osv (om cleanOutputText finns)
//   - Om modellen skulle lämna JSON → vi använder ändå bara ren text från motorn
//   - generateStoryWithIPFilter ritar INTE i DOM, den returnerar bara text
//
// Exponeras globalt som: window.generateStoryWithIPFilter
// =====================================================================

(function (global) {
  "use strict";

  const BNKidsIP = global.BNKidsIP || {};
  const BNStoryEngine = global.BNStoryEngine;

  if (!BNStoryEngine || typeof BNStoryEngine.generateChapter !== "function") {
    console.error(
      "generateStory_ip.js: BNStoryEngine saknas – kontrollera load order (story_engine.dev.js före denna fil)."
    );
  }

  // Fallback-sanitizer om filerna inte skulle vara laddade (ska helst aldrig användas)
  function fallbackSanitizePrompt(prompt) {
    const p = (prompt || "").trim();
    return {
      sanitizedPrompt: p,
      hadIP: false,
      blockedTerms: [],
      explanationPrefix: ""
    };
  }

  // Hjälp: hämta sanitizePrompt + cleanOutputText på ett säkert sätt
  function getSanitizeFn() {
    if (BNKidsIP && typeof BNKidsIP.sanitizePrompt === "function") {
      return BNKidsIP.sanitizePrompt.bind(BNKidsIP);
    }
    return fallbackSanitizePrompt;
  }

  function getCleanOutputFn() {
    if (BNKidsIP && typeof BNKidsIP.cleanOutputText === "function") {
      return BNKidsIP.cleanOutputText.bind(BNKidsIP);
    }
    // fallback: no-op
    return function (text) {
      return {
        cleanedText: text || "",
        hadIPInOutput: false,
        blockedOutputTerms: []
      };
    };
  }

  // Hjälp: bestäm kapitelIndex om det inte är angivet
  function inferChapterIndex(worldState, storyStateIn, explicitIndex) {
    if (explicitIndex && explicitIndex > 0) return explicitIndex;

    if (storyStateIn && Array.isArray(storyStateIn.previousChapters)) {
      const n = storyStateIn.previousChapters.length;
      if (n > 0) return n + 1;
    }

    if (worldState && Array.isArray(worldState.chapters)) {
      const n = worldState.chapters.length;
      if (n > 0) return n + 1;
    }

    return 1;
  }

  // -------------------------------------------------------------------
  // Main wrapper: generateStoryWithIPFilter(rawPrompt, options)
  // -------------------------------------------------------------------
  async function generateStoryWithIPFilter(rawPrompt, options) {
    options = options || {};

    if (!BNStoryEngine || typeof BNStoryEngine.generateChapter !== "function") {
      throw new Error("generateStoryWithIPFilter: BNStoryEngine saknas.");
    }

    const worldState = options.worldState;
    const storyStateIn = options.storyState || {};

    if (!worldState) {
      throw new Error(
        "generateStoryWithIPFilter: worldState saknas i options."
      );
    }

    const sanitizePrompt = getSanitizeFn();
    const cleanOutputText = getCleanOutputFn();

    // -------------------------------------------------------
    // 1) IP-skydd på barnets prompt
    // -------------------------------------------------------
    const raw = rawPrompt || "";
    const ipSanitized = sanitizePrompt(raw);
    const sanitizedPrompt = ipSanitized.sanitizedPrompt || raw;
    const hadIPInPrompt = !!ipSanitized.hadIP;
    const blockedPrompt = ipSanitized.blockedTerms || [];
    const explanationPref = ipSanitized.explanationPrefix || "";

    // -------------------------------------------------------
    // 2) Lägg in sanerad prompt i worldState för motorn
    //    Vi gör en shallow-copy så vi inte sabbar originalet.
    // -------------------------------------------------------
    const effectiveWorldState = Object.assign({}, worldState, {
      _userPrompt: sanitizedPrompt
    });

    // -------------------------------------------------------
    // 3) Räkna ut vilket kapitel vi är i
    // -------------------------------------------------------
    const chapterIndex = inferChapterIndex(
      effectiveWorldState,
      storyStateIn,
      options.chapterIndex
    );

    // -------------------------------------------------------
    // 4) Kör BN Story Engine v10.3
    // -------------------------------------------------------
    const engine = await BNStoryEngine.generateChapter({
      apiUrl: options.apiUrl || "/api/generate_story",
      worldState: effectiveWorldState,
      storyState: storyStateIn,
      chapterIndex: chapterIndex
    });

    let chapterText = engine.chapterText || "";
    let nextStoryState = engine.storyState || storyStateIn;

    // -------------------------------------------------------
    // 5) IP-skydd även på utgående text (blockera LEGO, Disney, osv.)
    // -------------------------------------------------------
    let hadIPInOutput = false;
    let blockedOutput = [];

    if (typeof cleanOutputText === "function") {
      const cleaned = cleanOutputText(chapterText);
      chapterText = cleaned.cleanedText || chapterText;
      hadIPInOutput = !!cleaned.hadIPInOutput;
      blockedOutput = cleaned.blockedOutputTerms || [];
    }

    const blockedAll = Array.from(
      new Set([].concat(blockedPrompt, blockedOutput))
    );

    // -------------------------------------------------------
    // 6) Lägg till förklaringen EN GÅNG, i kapitel 1,
    //    och BARA om prompten hade upphovsrättsskyddat IP
    // -------------------------------------------------------
    let finalText = chapterText;
    if (hadIPInPrompt && chapterIndex === 1 && explanationPref) {
      finalText = explanationPref + "\n\n" + chapterText;
    }

    // -------------------------------------------------------
    // 7) Returnera stabilt paket tillbaka till UI:t
    // -------------------------------------------------------
    return {
      text: finalText,
      hadIP: hadIPInOutput || hadIPInPrompt,
      hadIPInPrompt: hadIPInPrompt,
      hadIPInOutput: hadIPInOutput,
      blockedTerms: blockedAll,
      storyState: nextStoryState,
      engineVersion: engine.engineVersion || "unknown"
    };
  }

  // -------------------------------------------------------------------
  // Exponera globalt
  // -------------------------------------------------------------------
  global.generateStoryWithIPFilter = generateStoryWithIPFilter;
})(window);
