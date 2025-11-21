// ===============================================================
// BN-KIDS — STORY ENGINE (DEV v10b GC)
// ---------------------------------------------------------------
// Anpassad till BN-Kids v10-strategin:
// - Bara två åldersband i motorn: junior_7_9 (7–9), mid_10_12 (10–12)
// - 13–15 är PAUSAT (all ålder > 9 hanteras som 10–12)
// - Åldersband styr ton + ordlängd (kortare & enklare för 7–9,
//   längre & djupare för 10–12)
// - Minskar moralkake-bonanza (visa lärandet i handling istället)
// - Barnets prompt/idé måste respekteras men görs barnvänlig
// - Kapitellogik bibehållen (chapterIndex styr fortsatt flöde)
//
// Exponeras som: window.BNStoryEngine
// Används bl.a. av: generateStory_ip.js (IP-wrappern)
//
// Viktigt: story_engine.dev.js MÅSTE laddas före generateStory_ip.js
// ===============================================================

(function (global) {
  "use strict";

  const ENGINE_VERSION = "bn-story-engine-v10b";

  // ------------------------------------------------------------
  // Inbyggda åldersband (BN-Kids v10 strategi)
  // ------------------------------------------------------------
  // OBS: Teen/13–15 är PAUSAT i denna version.
  // All ålder >= 10 hanteras som "mid_10_12".
  const AGE_BANDS = {
    junior_7_9: {
      id: "junior_7_9",
      label: "7–9 år",
      chapter_words_target: 650,   // ca 450–750 i praktiken
      chapter_words_min: 450,
      chapter_words_max: 800,
      prompt_instructions:
        "Skriv enkelt, lekfullt och tryggt. Korta meningar, konkret handling, lite humor. Ingen romantik, inga subplots.",
      violence_level: "none_soft",
      romance_level: "none"
    },
    mid_10_12: {
      id: "mid_10_12",
      label: "10–12 år",
      chapter_words_target: 1100,  // ca 800–1500 i praktiken
      chapter_words_min: 800,
      chapter_words_max: 1500,
      prompt_instructions:
        "Skriv äventyrligt men tryggt, med lite djupare känslor och relationer. En enkel subplot är okej, men behåll fokus på huvudkonflikten.",
      violence_level: "soft_fantasy",
      romance_level: "crush_only"
    }
  };

  // ------------------------------------------------------------
  // Hjälp: plocka ålder som siffra ur meta
  // ------------------------------------------------------------
  function extractAge(meta) {
    if (!meta) return 10; // fall back mitt i spannet
    const raw = meta.ageValue || meta.age || meta.ageLabel || "";
    const m = String(raw).match(/(\d{1,2})/);
    return m ? parseInt(m[1], 10) : 10;
  }

  // ------------------------------------------------------------
  // Beräkna age band (7–9, 10–12) — 13–15 = pausat
  // ------------------------------------------------------------
  function pickAgeBand(meta) {
    const age = extractAge(meta);

    let bandId;
    if (age <= 9) {
      bandId = "junior_7_9";
    } else {
      // Allt 10+ -> behandlas som 10–12 i v10 (teen pausat)
      bandId = "mid_10_12";
    }

    const cfg = AGE_BANDS[bandId];

    const target =
      (cfg && cfg.chapter_words_target) ||
      (cfg && cfg.chapter_words_min && cfg.chapter_words_max
        ? Math.round((cfg.chapter_words_min + cfg.chapter_words_max) / 2)
        : 1000);

    const toneText =
      (cfg && cfg.prompt_instructions) || "";

    return {
      id: bandId,
      label: (cfg && cfg.label) || bandId,
      wordGoal: target,
      toneText: toneText,
      violence_level: (cfg && cfg.violence_level) || "",
      romance_level: (cfg && cfg.romance_level) || "",
      wordsMin: (cfg && cfg.chapter_words_min) || 600,
      wordsMax: (cfg && cfg.chapter_words_max) || 1400
    };
  }

  // ------------------------------------------------------------
  // Bestäm längdpreset (Kort / Lagom / Lång) grovt
  // (vi använder inbyggda rimliga standarder; inga externa JSONs)
  // ------------------------------------------------------------
  function resolveLengthPreset(meta, ageBand) {
    const defaultPreset = "medium";
    const lp =
      (meta && (meta.lengthValue || meta.lengthPreset || meta.length)) ||
      defaultPreset;

    const presetKey =
      /kort/i.test(lp) ? "short" :
      /lång/i.test(lp) ? "long" :
      "medium";

    // Grova standardintervall beroende på preset, oberoende av band
    // (bandet har ändå egen min/max, så detta är mest "hint")
    if (presetKey === "short") {
      return { id: "short", min: Math.max(300, ageBand.wordsMin - 200), max: ageBand.wordsMin + 100, label: "kort" };
    }
    if (presetKey === "long") {
      return { id: "long", min: ageBand.wordsMax - 300, max: ageBand.wordsMax + 400, label: "lång" };
    }
    // medium
    return {
      id: "medium",
      min: Math.round((ageBand.wordsMin * 0.8)),
      max: Math.round((ageBand.wordsMax * 1.1)),
      label: "lagom"
    };
  }

  // ------------------------------------------------------------
  // Trimma bort halv mening
  // ------------------------------------------------------------
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

  // ------------------------------------------------------------
  // Bygg systemprompt för motorn
  // ------------------------------------------------------------
  function buildPrompt(opts) {
    const { worldState, storyState, chapterIndex, ageBand, lengthPreset } = opts;

    const meta = worldState.meta || {};
    const hero = meta.hero || "hjälten";

    // Barnets idé / önskemål (detta är centralt för röd tråd)
    const childIdea =
      worldState._userPrompt ||
      worldState.last_prompt ||
      meta.originalPrompt ||
      "";

    const mode =
      worldState.story_mode ||
      (chapterIndex > 1 ? "chapter_book" : "single_story");

    const isFirstChapter = chapterIndex === 1;

    // Recap (om vi har något i storyState)
    let recapText = "";
    if (storyState && typeof storyState.previousSummary === "string") {
      recapText = storyState.previousSummary.trim();
    } else if (storyState && Array.isArray(storyState.previousChapters)) {
      const last = storyState.previousChapters[storyState.previousChapters.length - 1];
      if (last && typeof last === "string") {
        recapText = last.slice(0, 800);
      }
    }

    // Struktur-instruktioner beroende på kapitel
    const structureInstr = isFirstChapter
      ? [
          "Detta är kapitel 1 i berättelsen.",
          "Etablera huvudpersonen, miljön och den huvudsakliga konflikten.",
          "Skapa en känsla av att berättelsen kommer fortsätta, men lös inte hela huvudkonflikten."
        ]
      : [
          `Detta är kapitel ${chapterIndex} i en pågående kapitelbok.`,
          "Fortsätt från slutet av förra kapitlet, starta inte om samma dag eller samma konflikt.",
          "Låt viktiga händelser från tidigare kapitel påverka vad som händer nu.",
          "Om användaren ber om avslut på boken: knyt ihop huvudkonflikten utan att starta en helt ny berättelse."
        ];

    // Ålders-/ton-instruktion
    const toneLines = [];

    if (ageBand.toneText) {
      toneLines.push(ageBand.toneText);
    }

    if (ageBand.violence_level) {
      toneLines.push(
        "Våldsnivå: håll det på nivå " +
          ageBand.violence_level +
          ", inget grafiskt våld eller blodiga detaljer."
      );
    }
    if (ageBand.romance_level) {
      toneLines.push(
        "Romantik: högst nivå " +
          ageBand.romance_level +
          ", inget explicit innehåll."
      );
    }

    // Barnets idé måste respekteras
    const ideaLines = [];
    if (childIdea) {
      ideaLines.push(
        'Barnets idé / önskan är: "' + childIdea + '".'
      );
      ideaLines.push(
        "Du måste RESPEKTERA denna idé. Utveckla den, fördjupa den och gör den barnvänlig, " +
        "men byt inte tema helt och ignorera den inte."
      );
    } else {
      ideaLines.push(
        "Det finns ingen extra formulerad önskan just nu. Bygg vidare logiskt på hjälten och situationen."
      );
    }

    // Moralkake-regler
    const antiMoralLines = [
      "Undvik långa moraliska monologer, föreläsningar och motivationsprat.",
      "Skriv inte saker som 'sensmoralen är...' eller upprepa samma budskap om och om igen.",
      "Visa istället vad karaktärerna lär sig genom handling, dialog och konsekvenser.",
      "Undvik att lägga in långa stycken där berättaren direkt talar om för läsaren hur man ska känna eller tänka."
    ];

    const lp = lengthPreset;

    // Bygg själva prompten
    const lines = [
      `Du är BN-KIDS sagomotor (${ENGINE_VERSION}).`,
      `Du skriver på naturlig, korrekt svenska för målgruppen ${ageBand.label}.`,
      "",
      "ÖVERGRIPANDE UPPDRAG:",
      mode === "chapter_book"
        ? "Skriv nästa kapitel i en barnbok för 7–12 år med tydlig röd tråd."
        : "Skriv en fristående saga med tydlig början, mitt och slut.",
      "",
      "HJÄLTE:",
      `- Huvudpersonen heter ${hero} och ska konsekvent kallas "${hero}".`,
      "",
      "BARNETS IDÉ / ÖNSKAN:",
      ...ideaLines.map((t) => "- " + t),
      "",
      "ÅLDER & TON:",
      `- Målgrupp: ${ageBand.label} (BN-Kids v10, endast 7–12 år – inga tonårsteman).`,
      `- Kapitlet ska kännas anpassat till denna ålder (språk, längd, tema).`,
      ...toneLines.map((t) => "- " + t),
      "",
      "LÄNGD:",
      `- Sikta på ungefär ${ageBand.wordGoal} ord.`,
      `- Försök hålla dig inom intervallet ${lp.min}–${lp.max} ord.`,
      "- Det är viktigare att kapitlet känns komplett än att det är superlångt.",
      "",
      "STRUKTUR FÖR KAPITLET:",
      ...structureInstr.map((t) => "- " + t),
      "- Avsluta alltid kapitlet med en fullständig mening (ingen halv mening på slutet).",
      "",
      "LOGIK:",
      "- Starta inte om samma händelse flera gånger.",
      "- Om en figur har lärt sig något tidigare (t.ex. flyga, spruta eld, spela match),",
      "  får hen inte plötsligt bli nybörjare igen utan tydlig orsak.",
      "- Håll fast vid samma värld, samma konflikter och samma huvudpersoner som i tidigare kapitel.",
      "",
      "MORAL / LÄRDOMAR:",
      ...antiMoralLines.map((t) => "- " + t),
      "",
      "TIDIGARE HÄNDELSER:",
      recapText
        ? "Kort sammanfattning av vad som hänt hittills:\n" + recapText
        : isFirstChapter
        ? "Det finns inga tidigare kapitel. Detta är starten på berättelsen."
        : "Tidigare kapitel finns, men ingen extra sammanfattning skickas. Fortsätt logiskt framåt.",
      "",
      "SVARSFORMAT:",
      "Svara i ren text, utan JSON. Bara själva kapiteltexten."
    ];

    return lines.join("\n");
  }

  // ------------------------------------------------------------
  // Hämta text från API-svar (OpenAI/Mistral-kompatibelt)
  // ------------------------------------------------------------
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
    } catch (_) {
      // ignore
    }

    return JSON.stringify(apiResponse);
  }

  // ------------------------------------------------------------
  // API-anrop
  // ------------------------------------------------------------
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

  // ------------------------------------------------------------
  // HUVUD: GENERATE CHAPTER
  // ------------------------------------------------------------
  async function generateChapter(opts) {
    const {
      apiUrl = "/api/generate_story",
      worldState,
      storyState = {},
      chapterIndex = 1
    } = opts || {};

    if (!worldState) {
      throw new Error("BNStoryEngine: worldState saknas.");
    }

    const meta = worldState.meta || {};

    const ageBand      = pickAgeBand(meta);
    const lengthPreset = resolveLengthPreset(meta, ageBand);

    const prompt = buildPrompt({
      worldState,
      storyState,
      chapterIndex,
      ageBand,
      lengthPreset
    });

    const payload = {
      prompt,
      age: meta.ageValue || meta.age || "",
      hero: meta.hero || "",
      length: meta.lengthValue || meta.length || "",
      lang: "sv",
      engineVersion: ENGINE_VERSION,
      worldState,
      storyState,
      chapterIndex
    };

    const apiRaw    = await callApi(apiUrl, payload);
    const modelText = extractModelText(apiRaw);

    let chapterText = modelText || "";

    // Grovt max-tak i tecken (≈ 6 tecken/ord)
    const approxMaxChars =
      (lengthPreset.max || ageBand.wordGoal || 1000) * 6;

    chapterText = trimToWholeSentence(
      chapterText.slice(0, approxMaxChars)
    );

    return {
      chapterText,
      storyState: storyState || {},
      engineVersion: ENGINE_VERSION,
      ageBand: ageBand
    };
  }

  // ------------------------------------------------------------
  // Exportera globalt
  // ------------------------------------------------------------
  global.BNStoryEngine = {
    generateChapter,
    ENGINE_VERSION
  };
})(window);
