// ===============================================================
// BN-KIDS — STORY ENGINE DEV (V10)
// - Tydliga åldersnivåer (7–9, 10–12, 13–15)
// - Mindre moralkakor och “det viktigaste är…”-dravel
// - Mer realistiska detaljer för sport/musik/ämnen i prompten
// - Bättre sista-kapitlet-logik (”avsluta boken”, ”sista kapitlet”)
// ===============================================================

(function (global) {
  "use strict";

  const ENGINE_VERSION = "bn-story-engine-v10";

  // --------------------------------------------------------------
  // Åldersband — grova ramar för längd och stil
  // OBS: detta är inte exakt din stora JSON, utan en komprimerad version
  // som är lätt att styra i prompten.
  // --------------------------------------------------------------
  const AGE_BANDS = {
    "junior_7_9": {
      id: "junior_7_9",
      label: "7–9 år",
      wordMin: 350,
      wordMax: 650,
      maxChars: 1400,
      tone: "lekfull, trygg, humoristisk, konkreta händelser, korta meningar",
      instructions:
        "Skriv med korta, tydliga meningar. Få personer per scen. Håll språket enkelt och konkret. Visa känslor genom vad barnen gör snarare än långa inre monologer."
    },
    "mid_10_12": {
      id: "mid_10_12",
      label: "10–12 år",
      wordMin: 700,
      wordMax: 1200,
      maxChars: 2000,
      tone: "äventyrlig, känslosam men trygg, lite mer komplex",
      instructions:
        "Tillåt lite mer inre tankar och känslor. En enkel sidotråd kan finnas, men fokus ska ligga på huvudäventyret. Språket får gärna vara lite mer varierat, men fortfarande tydligt."
    },
    "teen_13_15": {
      id: "teen_13_15",
      label: "13–15 år",
      wordMin: 1000,
      wordMax: 1800,
      maxChars: 2600,
      tone: "mognare men trygg, mer inre liv och reflektion",
      instructions:
        "Använd mer inre tankar, identitetsfrågor och känslomässigt djup. Relationer och lojalitet kan spela större roll. Håll allt på PG-13-nivå, ingen explicit romantik eller grafiskt våld."
    }
  };

  // --------------------------------------------------------------
  // Hjälpare: bestäm åldersband utifrån meta.age / ageLabel / ålder
  // --------------------------------------------------------------
  function determineAgeBand(ageInputOrMeta) {
    let age = null;
    let label = "";

    if (ageInputOrMeta && typeof ageInputOrMeta === "object") {
      const meta = ageInputOrMeta;
      const raw =
        meta.actualAge ||
        meta.age ||
        meta.ageValue ||
        meta.ageLabel ||
        "";
      label = String(raw || "");
      const m = String(raw || "").match(/(\d{1,2})/);
      if (m) age = parseInt(m[1], 10);
    } else {
      const raw = ageInputOrMeta;
      label = String(raw || "");
      const m = String(raw || "").match(/(\d{1,2})/);
      if (m) age = parseInt(m[1], 10);
    }

    if (!age || isNaN(age)) {
      // fallback
      return AGE_BANDS["mid_10_12"];
    }

    if (age <= 9) return AGE_BANDS["junior_7_9"];
    if (age <= 12) return AGE_BANDS["mid_10_12"];
    return AGE_BANDS["teen_13_15"];
  }

  // --------------------------------------------------------------
  // Trimma bort halv mening
  // --------------------------------------------------------------
  function trimToWholeSentence(text) {
    let t = (text || "").trim();
    const lastDot = Math.max(
      t.lastIndexOf("."),
      t.lastIndexOf("!"),
      t.lastIndexOf("?")
    );
    if (lastDot !== -1) return t.slice(0, lastDot + 1);
    return t;
  }

  // --------------------------------------------------------------
  // Kolla om barnet ber om avslut (sista kapitlet)
  // --------------------------------------------------------------
  function detectEndIntent(worldState, storyState) {
    const hints = [
      "sista kapitlet",
      "sista kapitlet.",
      "sista kapitlet!",
      "avsluta boken",
      "avsluta berättelsen",
      "knyt ihop allt",
      "knyt ihop hela berättelsen",
      "gör ett slut",
      "ge ett slut",
      "skriv slutet"
    ];

    let source =
      (worldState && worldState._userPrompt) ||
      (worldState && worldState.last_prompt) ||
      (storyState && storyState.last_wish) ||
      "";

    const lower = String(source || "").toLowerCase();
    if (!lower) return false;

    return hints.some((h) => lower.includes(h));
  }

  // --------------------------------------------------------------
  // BYGG SUPERMOTORN-PROMPT (V10)
  // --------------------------------------------------------------
  function buildPrompt(opts) {
    const {
      worldState,
      storyState,
      chapterIndex,
      ageBand,
      isLastChapter
    } = opts;

    const meta = worldState && worldState.meta ? worldState.meta : {};
    const hero = meta.hero || "hjälten";
    const ageLabel =
      meta.ageLabel || meta.age || ageBand.label || "barn i mellanstadieålder";

    const rawUserPrompt =
      (worldState && worldState._userPrompt) ||
      meta.last_prompt ||
      worldState.last_prompt ||
      "";

    const chapters = (storyState && storyState.chapters) || [];
    const previousSummary = storyState && storyState.summary;

    // En enkel recap baserad på StoryState (om den finns)
    let recapBlock = "";
    if (!chapters || chapters.length === 0) {
      recapBlock =
        "Detta är första kapitlet. Inga tidigare kapitel finns ännu.\n";
    } else {
      const lastChapterText = chapters[chapters.length - 1] || "";
      recapBlock =
        "Kort påminnelse om slutet på förra kapitlet (fortsätt härifrån, starta inte om):\n" +
        lastChapterText.slice(0, 600).replace(/\s+/g, " ").trim() +
        "\n";
    }

    const endInstr = isLastChapter
      ? [
          "DETTA SKA VARA DET SISTA KAPITLET I BOKEN.",
          "- Knyt ihop de viktigaste händelserna från tidigare kapitel.",
          "- Lös huvudkonflikten. Starta INTE ett helt nytt äventyr.",
          "- Lämna barnet med en tydlig, lugn känsla. Ingen cliffhanger.",
          "- Du får gärna vara varm och hoppfull, men undvik övertydliga moralkakor."
        ].join("\n")
      : [
          "DETTA ÄR ETT MITTENKAPITEL.",
          "- Fortsätt direkt från slutet av förra kapitlet.",
          "- Starta inte om med en helt ny dag eller ett helt nytt äventyr.",
          "- Avsluta kapitlet med en fullständig mening som gör att man vill läsa vidare,"
            + " men utan att introducera en helt ny, stor konflikt precis i slutet."
        ].join("\n");

    const realismInstr = [
      "REALISM OCH KORREKTA DETALJER:",
      "- Om berättelsen handlar om en konkret aktivitet (t.ex. fotboll, hockey, ridning, musik, spel):",
      "  * Använd grundläggande korrekta detaljer och ord.",
      "  * Om du är osäker, håll dig hellre neutral än att hitta på felaktiga fakta.",
      "- Om barnet nämner verkliga lag, klubbar, turneringar, instrument eller andra detaljer,",
      "  beskriv dem på ett trovärdigt sätt utan att bli tekniskt överdriven."
    ].join("\n");

    const antiMoralInstr = [
      "UNDVIK MORALKAKOR:",
      "- Berättelsen får gärna kännas varm och positiv,",
      "  men undvik att avsluta varje kapitel med övertydliga budskap som:",
      '  \"det viktigaste är att vara snäll\" eller \"det viktigaste är vänskap\".',
      "- Låt istället handlingen och karaktärernas val visa utvecklingen.",
      "- Skriv inte som en skoluppsats eller predikan."
    ].join("\n");

    const lengthInstr = [
      "LÄNGD:",
      `- Sikte: ungefär ${ageBand.wordMin}–${ageBand.wordMax} ord.`,
      "- Det är viktigare att kapitlet känns helt och läsbart än att exakt träffa antalet ord.",
      "- Avsluta med en hel mening (ingen avbruten mening)."
    ].join("\n");

    const toneInstr = [
      "STIL OCH TON FÖR ÅLDERN:",
      `- Målgrupp: ${ageLabel}.`,
      `- Ton: ${ageBand.tone}.`,
      `- Extra instruktioner: ${ageBand.instructions}`
    ].join("\n");

    return [
      `Du är BN-KIDS sagomotor (${ENGINE_VERSION}).`,
      `Du skriver kapitel ${chapterIndex} i en pågående barnbok.`,
      "",
      "ALLMÄNT:",
      "- Skriv på naturlig, korrekt svenska.",
      "- Håll dig till barnets värld och de figurer som redan finns med.",
      "- Uppfinn INTE fakta som barnet inte har nämnt (t.ex. djur som plötsligt får namn utan att någon döper dem).",
      "- Om något får ett namn (hund, drake, plats), låt karaktärerna NAMNGE det i scenen.",
      "",
      toneInstr,
      "",
      lengthInstr,
      "",
      realismInstr,
      "",
      antiMoralInstr,
      "",
      endInstr,
      "",
      "ÖNSKAN/IDÉ FRÅN BARNET (aktuell prompt/idé):",
      rawUserPrompt ? `"${rawUserPrompt}"` : "(ingen särskild önskan just nu)",
      "",
      "SAMMANFATTNING AV BERÄTTELSEN HITTILLS:",
      previousSummary
        ? String(previousSummary)
        : "(ingen separat sammanfattning, använd istället kapitel-historiken nedan)",
      "",
      recapBlock,
      "",
      "STRUKTUR DU SKA FÖLJA FÖR DETTA KAPITEL:",
      "1. En kort koppling till föregående kapitel (max 1–2 meningar).",
      "2. EN tydlig huvudscen som driver berättelsen framåt.",
      "3. Naturlig dialog och känslor (utan att överförklara allt).",
      "4. Ett tydligt avslut på kapitlet (inte mitt i en mening).",
      "",
      "SVARSFORMAT (VIKTIGT):",
      '{ "chapterText": "...", "storyState": { ... valfri uppdaterad info ... } }',
      "chapterText ska vara ren läsbar text, inte Markdown."
    ].join("\n");
  }

  // --------------------------------------------------------------
  // Hämta text från API-svar (OpenAI/Mistral-kompatibelt)
  // --------------------------------------------------------------
  function extractModelText(apiResponse) {
    if (!apiResponse) return "";
    if (typeof apiResponse === "string") return apiResponse;
    if (typeof apiResponse.text === "string") return apiResponse.text;
    if (typeof apiResponse.story === "string") return apiResponse.story;

    try {
      if (
        apiResponse.choices &&
        apiResponse.choices[0] &&
        apiResponse.choices[0].message &&
        typeof apiResponse.choices[0].message.content === "string"
      ) {
        return apiResponse.choices[0].message.content;
      }
    } catch (_) {}

    return JSON.stringify(apiResponse);
  }

  // --------------------------------------------------------------
  // Försök tolka JSON från modellen
  // --------------------------------------------------------------
  function extractJson(text) {
    if (!text) return null;
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first === -1 || last === -1) return null;

    try {
      return JSON.parse(text.slice(first, last + 1));
    } catch (_) {
      return null;
    }
  }

  // --------------------------------------------------------------
  // API-anrop (används bara om man kör mot API direkt härifrån)
  // --------------------------------------------------------------
  async function callApi(apiUrl, payload) {
    const r = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });

    let raw;
    try {
      raw = await r.json();
    } catch (_) {
      raw = await r.text();
    }
    return raw;
  }

  // --------------------------------------------------------------
  // HUVUD: GENERATE CHAPTER
  // --------------------------------------------------------------
  async function generateChapter(opts) {
    const {
      apiUrl = "/api/generate_story",
      worldState,
      storyState = {},
      chapterIndex = 1
    } = opts || {};

    if (!worldState) throw new Error("BNStoryEngine: worldState saknas.");

    const meta = worldState.meta || {};
    const ageBand = determineAgeBand(meta);

    const isLastChapter = detectEndIntent(worldState, storyState);

    const prompt = buildPrompt({
      worldState,
      storyState,
      chapterIndex,
      ageBand,
      isLastChapter
    });

    const payload = {
      prompt,
      age: meta.age,
      hero: meta.hero,
      length: meta.length,
      engineVersion: ENGINE_VERSION,
      worldState,
      storyState,
      chapterIndex
    };

    const apiRaw = await callApi(apiUrl, payload);
    const modelText = extractModelText(apiRaw);
    const json = extractJson(modelText);

    let chapterText;
    let newState;

    if (json && json.chapterText) {
      chapterText = json.chapterText;
      newState = json.storyState || storyState;
    } else {
      chapterText = modelText;
      newState = storyState;
    }

    // trim till hel mening & maxlängd per ålder
    chapterText = trimToWholeSentence(
      chapterText.slice(0, ageBand.maxChars)
    );

    return {
      chapterText,
      storyState: newState,
      engineVersion: ENGINE_VERSION,
      ageBand: ageBand
    };
  }

  // --------------------------------------------------------------
  global.BNStoryEngine = {
    generateChapter,
    ENGINE_VERSION
  };
})(window);

// =====================================================================
// BN-KIDS — generateStoryWithIPFilter (samma API som tidigare)
// IP-skydd + koppling till BNStoryEngine v10
// =====================================================================

(function (global) {
  "use strict";

  const BNKidsIP = global.BNKidsIP || {};
  const BNStoryEngine = global.BNStoryEngine;

  if (!BNStoryEngine || typeof BNStoryEngine.generateChapter !== "function") {
    console.error(
      "generateStory.dev.js: StoryEngine saknas – kontrollera load order."
    );
  }
  if (!BNKidsIP || typeof BNKidsIP.sanitizePrompt !== "function") {
    console.error(
      "generateStory.dev.js: IP-sanitizer saknas – kontrollera load order."
    );
  }

  // -----------------------------------------------------------
  // Hjälp: rensa ut JSON-klump om modellen råkar svara så
  // -----------------------------------------------------------
  function extractChapterTextFromPossibleJson(text) {
    if (typeof text !== "string") return text;

    const trimmed = text.trim();
    if (!trimmed.startsWith("{")) return text;
    if (!trimmed.includes('"chapterText"')) return text;

    try {
      const j = JSON.parse(trimmed);
      if (j && typeof j.chapterText === "string") return j.chapterText;
    } catch (_) {}

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

    const worldState = options.worldState;
    const storyStateIn = options.storyState || {};
    const chapterIndex = options.chapterIndex || 1;

    if (!worldState) {
      throw new Error(
        "generateStoryWithIPFilter: worldState saknas i options."
      );
    }

    // 1) Sanera barnets prompt (IP-skydd)
    const ipSanitized = BNKidsIP.sanitizePrompt(rawPrompt || "");
    const sanitizedPrompt = ipSanitized.sanitizedPrompt;
    const hadIPInPrompt = ipSanitized.hadIP;
    const blockedPrompt = ipSanitized.blockedTerms || [];
    const explanationPref = ipSanitized.explanationPrefix || "";

    // stoppa in sanerad prompt i worldState så motorn får info
    const effectiveWorldState = Object.assign({}, worldState, {
      _userPrompt: sanitizedPrompt
    });

    // 2) Kör BN Story Engine v10
    const engine = await BNStoryEngine.generateChapter({
      apiUrl: options.apiUrl || "/api/generate_story",
      worldState: effectiveWorldState,
      storyState: storyStateIn,
      chapterIndex: chapterIndex
    });

    let chapterText = engine.chapterText || "";

    // 3) Om modellen råkar svara JSON → plocka ut ren text
    chapterText = extractChapterTextFromPossibleJson(chapterText);

    // 4) IP-skydd även på utgående text (blockera LEGO etc)
    let hadIPInOutput = false;
    let blockedOutput = [];

    if (typeof BNKidsIP.cleanOutputText === "function") {
      const cleaned = BNKidsIP.cleanOutputText(chapterText);
      chapterText = cleaned.cleanedText || chapterText;
      hadIPInOutput = cleaned.hadIPInOutput || false;
      blockedOutput = cleaned.blockedOutputTerms || [];
    }

    const blockedAll = Array.from(
      new Set([].concat(blockedPrompt, blockedOutput))
    );

    // 5) Lägg bara till förklaringen EN GÅNG, i kapitel 1,
    //    och BARA om prompten hade upphovsrättsskyddat IP
    let finalText = chapterText;
    if (hadIPInPrompt && chapterIndex === 1 && explanationPref) {
      finalText = explanationPref + "\n\n" + chapterText;
    }

    // 6) Returnera stabilt paket
    return {
      text: finalText,
      hadIP: hadIPInOutput || hadIPInPrompt,
      hadIPInPrompt: hadIPInPrompt,
      hadIPInOutput: hadIPInOutput,
      blockedTerms: blockedAll,
      storyState: engine.storyState || storyStateIn,
      engineVersion: engine.engineVersion
    };
  }

  // -----------------------------------------------------------
  // Exponera globalt
  // -----------------------------------------------------------
  global.generateStoryWithIPFilter = generateStoryWithIPFilter;
})(window);
