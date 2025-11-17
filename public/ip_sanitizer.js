// ==========================================================
// BN-KIDS — IP SANITIZER (v2)
// - Bygger ovanpå BNKidsIP från ip_blocklist.js
// - Exponerar:
//    - BNKidsIP.sanitizePrompt(originalPrompt, options?)
//    - BNKidsIP.cleanOutputText(text, options?)
// ----------------------------------------------------------
// sanitizePrompt() -> filtrerar BARNETS PROMPT
// cleanOutputText() -> filtrerar MODELLENS SVAR (sagotext)
// ==========================================================
(function (global) {
  "use strict";

  const BNKidsIP = global.BNKidsIP || {};
  const DEFAULT_REPLACEMENT = "din favoritfigur";

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function buildLLMInstruction(hadIP) {
    let base =
      "Viktigt: Berättelsen får inte använda eller efterlikna upphovsrättsskyddade figurer, världar eller varumärken. " +
      "Skapa alltid helt originella karaktärer, platser och föremål.";

    if (hadIP) {
      base +=
        "\n- Texten ovan innehöll skyddat IP som har ersatts. " +
        "Se till att inget i berättelsen kan förväxlas med kända böcker, filmer, spel eller varumärken.\n" +
        "- Ändra namn, värld, personlighet och signaturdrag så att allt är unikt och eget.";
    }

    return base;
  }

  // --------------------------------------------------------
  // Filtrera PROMPTEN före LLM-anrop
  // --------------------------------------------------------
  BNKidsIP.sanitizePrompt = function sanitizePrompt(originalPrompt, options) {
    const prompt = originalPrompt || "";
    const replacement =
      (options && options.replacement) || DEFAULT_REPLACEMENT;

    const blockedTerms = BNKidsIP.detectBlockedTerms(prompt);
    const hadIP = blockedTerms.length > 0;

    let sanitized = prompt;

    if (hadIP) {
      let work = sanitized;

      blockedTerms.forEach(function (term) {
        if (!term) return;
        const pattern = new RegExp(escapeRegExp(term), "gi");
        work = work.replace(pattern, replacement);
      });

      sanitized = work;
    }

    const llmInstruction = buildLLMInstruction(hadIP);
    const sanitizedPrompt =
      sanitized.trim() + "\n\n" + llmInstruction.trim();

    let explanationPrefix = "";
    if (hadIP) {
      explanationPrefix =
        "Obs! Jag kan inte använda riktiga sagokaraktärer och figurer från böcker/filmer, " +
        "så jag hittade på en helt egen hjälte och en egen värld istället.";
    }

    return {
      sanitizedPrompt,
      hadIP,
      blockedTerms,
      explanationPrefix
    };
  };

  // --------------------------------------------------------
  // Filtrera MODELLENS SVAR efter LLM-anrop
  // --------------------------------------------------------
  BNKidsIP.cleanOutputText = function cleanOutputText(text, options) {
    const inputText = text || "";
    const replacement =
      (options && options.replacement) || DEFAULT_REPLACEMENT;

    const blockedTerms = BNKidsIP.detectBlockedTerms(inputText);
    const hadIP = blockedTerms.length > 0;

    if (!hadIP) {
      return {
        cleanedText: inputText,
        hadIPInOutput: false,
        blockedOutputTerms: []
      };
    }

    let cleaned = inputText;
    blockedTerms.forEach(function (term) {
      if (!term) return;
      const pattern = new RegExp(escapeRegExp(term), "gi");
      cleaned = cleaned.replace(pattern, replacement);
    });

    return {
      cleanedText: cleaned,
      hadIPInOutput: true,
      blockedOutputTerms: blockedTerms
    };
  };

  global.BNKidsIP = BNKidsIP;
})(window);
