// =====================================================================
// BN-KIDS — generateStoryWithIPFilter (GC-RESTORE v1)
// ---------------------------------------------------------------------
// Gör tre saker:
//  1) Sanerar barnets prompt från upphovsrättsskyddade figurer (IP-skydd)
//  2) Anropar /api/generate_story DIREKT med den sanerade prompten
//  3) Städar bort IP i modellens svar + lägger ev. en snäll förklaring
//
// Viktigt:
//  - INGEN koppling till BNStoryEngine här längre.
//  - INGA egna kapitelmallar, recaps eller strukturregler.
//  - All kapitel-logik sköts av worldstate/WS_DEV eller din backend.
//
// Exponeras globalt som: window.generateStoryWithIPFilter
// =====================================================================

(function (global) {
  "use strict";

  const BNKidsIP = global.BNKidsIP || {};

  if (!BNKidsIP || typeof BNKidsIP.sanitizePrompt !== "function") {
    console.error("generateStory.ip.js: BNKidsIP.sanitizePrompt saknas – kontrollera ip_sanitizer.js.");
  }

  // -----------------------------------------------------------
  // Hjälp: extrahera saga ur API-svar
  // -----------------------------------------------------------
  function extractStoryFromResponse(data) {
    if (!data) return "";

    // Vanlig BN-backend: { story: "..." }
    if (typeof data.story === "string") return data.story;

    // Alternativa fält
    if (typeof data.text === "string") return data.text;
    if (typeof data.content === "string") return data.content;

    // OpenAI-liknande svar
    try {
      if (
        data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        typeof data.choices[0].message.content === "string"
      ) {
        return data.choices[0].message.content;
      }
    } catch (_) {}

    // Sista utväg: försök tolka som sträng
    if (typeof data === "string") return data;

    try {
      return JSON.stringify(data);
    } catch (_) {
      return "";
    }
  }

  // -----------------------------------------------------------
  // Hjälp: trimma till hel mening
  // -----------------------------------------------------------
  function trimToWholeSentence(text) {
    if (!text) return "";
    let t = text.trim();
    const lastDot = Math.max(t.lastIndexOf("."), t.lastIndexOf("!"), t.lastIndexOf("?"));
    if (lastDot !== -1) return t.slice(0, lastDot + 1);
    return t;
  }

  // -----------------------------------------------------------
  // Hjälp: plocka meta från worldState (om det finns)
  // -----------------------------------------------------------
  function resolveMetaFromWorldState(worldState) {
    if (!worldState || typeof worldState !== "object") {
      return { age: "", hero: "", length: "" };
    }
    const meta = worldState.meta || {};
    return {
      age: meta.ageValue || meta.age || "",
      hero: meta.hero || "",
      length: meta.lengthValue || meta.length || ""
    };
  }

  // -----------------------------------------------------------
  // Main wrapper: generateStoryWithIPFilter(prompt, options)
  // -----------------------------------------------------------
  async function generateStoryWithIPFilter(rawPrompt, options) {
    options = options || {};

    if (!BNKidsIP || typeof BNKidsIP.sanitizePrompt !== "function") {
      throw new Error("generateStoryWithIPFilter: BNKidsIP.sanitizePrompt saknas.");
    }

    const worldState   = options.worldState || null;
    const storyStateIn = options.storyState || {};
    const chapterIndex = options.chapterIndex || 1;

    // 1) IP-skydd på barnets prompt
    const ipSanitized = BNKidsIP.sanitizePrompt(rawPrompt || "");
    const sanitizedPrompt = ipSanitized.sanitizedPrompt;
    const hadIPInPrompt   = !!ipSanitized.hadIP;
    const blockedPrompt   = ipSanitized.blockedTerms || [];
    const explanationPref = ipSanitized.explanationPrefix || "";

    // 2) Plocka age/hero/length (om de finns)
    const metaFromWS = resolveMetaFromWorldState(worldState);
    const age   = options.age   || metaFromWS.age   || "";
    const hero  = options.hero  || metaFromWS.hero  || "";
    const length= options.length|| metaFromWS.length|| "";

    // 3) Bygg request-body till /api/generate_story
    const body = {
      age: age,
      hero: hero,
      length: length,
      lang: options.language || options.lang || "sv",
      prompt: sanitizedPrompt,
      // extra info backend kan ignorera om den vill
      storyState: storyStateIn,
      chapterIndex: chapterIndex
    };

    const apiUrl = options.apiUrl || "/api/generate_story";

    // 4) Anropa backend
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(body)
    });

    let raw;
    try {
      raw = await res.json();
    } catch (_) {
      raw = await res.text();
      try {
        raw = JSON.parse(raw);
      } catch (_) {
        // behåll raw som string
      }
    }

    // 5) Plocka ut själva sagotexten
    let storyText = extractStoryFromResponse(raw);
    storyText = trimToWholeSentence(storyText);

    // 6) IP-skydd på utgående text
    let hadIPInOutput = false;
    let blockedOutput = [];

    if (typeof BNKidsIP.cleanOutputText === "function") {
      const cleaned = BNKidsIP.cleanOutputText(storyText);
      storyText     = cleaned.cleanedText || storyText;
      hadIPInOutput = !!cleaned.hadIPInOutput;
      blockedOutput = cleaned.blockedOutputTerms || [];
    }

    const blockedAll = Array.from(
      new Set([].concat(blockedPrompt, blockedOutput))
    );

    // 7) Lägg bara förklaringen i KAPITEL 1 och bara om prompten hade IP
    let finalText = storyText;
    if (hadIPInPrompt && chapterIndex === 1 && explanationPref) {
      finalText = explanationPref + "\n\n" + storyText;
    }

    // 8) Returnera stabil struktur
    return {
      text: finalText,
      hadIP: hadIPInPrompt || hadIPInOutput,
      hadIPInPrompt: hadIPInPrompt,
      hadIPInOutput: hadIPInOutput,
      blockedTerms: blockedAll,
      storyState: storyStateIn,    // vi pillar inte på detta här
      engineVersion: "bn-generateStory-ipfilter-gc-restore-v1"
    };
  }

  // -----------------------------------------------------------
  // Exponera globalt
  // -----------------------------------------------------------
  global.generateStoryWithIPFilter = generateStoryWithIPFilter;
})(window);
