// ===============================================================
// BN-KIDS — STORY ENGINE (GC v10.4)
// - Följer barnets prompt tydligare (focus lock light)
// - Skiljer på 7–9 och 10–12 i ton och längd
// - Mindre moralkakor, mer handling & dialog
// - Bättre kapitel-flöde (kapitelIndex + recap används internt)
// - Inga tvångstropes: ingen "mystisk röst bakom", inga eviga skatter
//
// Exponeras som: window.BNStoryEngine
// Används av: generateStoryWithIPFilter (om den finns) eller direkt
//
// Viktigt: story_config.gc.js måste laddas FÖRE denna fil.
// ===============================================================

(function (global) {
  "use strict";

  const ENGINE_VERSION = "bn-story-engine-v10.4-gc";

  const CONFIG = global.BN_STORY_CONFIG || {};
  const CFG_AGE_BANDS =
    (CONFIG.bn_kids_story_config &&
      CONFIG.bn_kids_story_config.age_bands) ||
    {};
  const CFG_LENGTH =
    (CONFIG.bn_kids_story_config &&
      CONFIG.bn_kids_story_config.length_presets) ||
    {};

  // ------------------------------------------------------------
  // Beräkna age band
  // ------------------------------------------------------------
  function pickAgeBand(meta) {
    const rawAge =
      (meta && (meta.ageValue || meta.age || meta.ageLabel)) || "";
    const m = String(rawAge).match(/(\d{1,2})/);
    const age = m ? parseInt(m[1], 10) : 10;

    let bandId;
    if (age <= 9) bandId = "junior_7_9";
    else if (age <= 12) bandId = "mid_10_12";
    else bandId = "mid_10_12"; // för nu: håll tonår lika nära mid

    const cfg = CFG_AGE_BANDS[bandId];
    if (!cfg) {
      // fallback
      return {
        id: bandId || "mid_10_12",
        label: "10–12 år",
        chapter_words_target: 1000,
        chapter_words_min: 700,
        chapter_words_max: 1500,
        tone:
          "äventyrlig men trygg, tydlig svenska, lite djup i känslor",
        violence_level: "soft_fantasy",
        romance_level: "crush_only"
      };
    }

    return cfg;
  }

  // ------------------------------------------------------------
  // Bestäm längdpreset (kort / lagom / lång)
  // ------------------------------------------------------------
  function resolveLengthPreset(meta, ageBandId) {
    const defaultPreset = "medium";
    const lp =
      (meta &&
        (meta.lengthValue ||
          meta.lengthPreset ||
          meta.length ||
          meta.lengthLabel)) ||
      defaultPreset;

    const presetKey = /kort/i.test(lp)
      ? "short"
      : /lång/i.test(lp)
      ? "long"
      : "medium";

    const bandKey = ageBandId || "mid_10_12";
    const preset =
      CFG_LENGTH[presetKey] &&
      CFG_LENGTH[presetKey].word_ranges_by_band &&
      CFG_LENGTH[presetKey].word_ranges_by_band[bandKey];

    if (!preset) {
      if (presetKey === "short") {
        return { id: "short", min: 400, max: 900, label: "kort" };
      }
      if (presetKey === "long") {
        return { id: "long", min: 1200, max: 2200, label: "lång" };
      }
      return { id: "medium", min: 800, max: 1600, label: "lagom" };
    }

    return {
      id: presetKey,
      min: preset.min,
      max: preset.max,
      label: CFG_LENGTH[presetKey].label || presetKey
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
  // Bygg systemprompt till modellen
  // ------------------------------------------------------------
  function buildPrompt(opts) {
    const { worldState, storyState, chapterIndex, ageBand, lengthPreset } =
      opts;

    const meta = worldState.meta || {};
    const hero = meta.hero || "hjälten";

    const childIdea =
      worldState._userPrompt ||
      worldState.last_prompt ||
      meta.originalPrompt ||
      "";

    const mode =
      worldState.story_mode ||
      (chapterIndex > 1 ? "chapter_book" : "single_story");

    const isFirstChapter = chapterIndex === 1;

    // Recap från worldState (uppdateras i ws_button.gc.js)
    const recapText =
      (worldState && worldState.previousSummary) ||
      (storyState && storyState.previousSummary) ||
      "";

    const structureInstr = [];
    if (mode === "chapter_book") {
      if (isFirstChapter) {
        structureInstr.push(
          "Detta är kapitel 1 i en kapitelbok.",
          "Etablera huvudpersonen, miljön och huvudproblemet.",
          "Ge läsaren en känsla av att mer väntar, men lös inte hela huvudkonflikten."
        );
      } else {
        structureInstr.push(
          `Detta är kapitel ${chapterIndex} i en pågående kapitelbok.`,
          "Fortsätt från slutet av förra kapitlet, starta inte om samma dag eller samma konflikt.",
          "Händelser och fakta måste vara konsekventa med tidigare kapitel.",
          "Om användaren ber om att avsluta boken: knyt ihop huvudkonflikten utan att upprepa hela berättelsen."
        );
      }
    } else {
      structureInstr.push(
        "Detta är en fristående saga.",
        "Skriv en tydlig början, mitt och slut.",
        "Lös huvudkonflikten i samma text."
      );
    }

    const toneLines = [];
    if (ageBand.tone) {
      toneLines.push(`Ton: ${ageBand.tone}.`);
    }
    if (ageBand.violence_level) {
      toneLines.push(
        "Våldsnivå: håll det på nivå " +
          ageBand.violence_level +
          ", inget grafiskt våld."
      );
    }
    if (ageBand.romance_level) {
      toneLines.push(
        "Romantik: högst nivå " +
          ageBand.romance_level +
          ". Oskyldigt, PG-13, inga explicita scener."
      );
    }

    // Fokus-lås (light)
    const focusLines = [
      "FOKUSLÅS:",
      "- Följ barnets prompt och huvudtema noggrant.",
      "- Byt inte genre eller ton utan att barnet bett om det.",
      "- Om barnet definierar ett yrke (t.ex. detektiv) ska detta vara centralt i kapitlet.",
      "- Om barnet definierar ett objekt (t.ex. en magisk bok, en diamant) ska det vara viktigt tills konflikten kring det är löst.",
      "- Inför inte mörk skräck, demoner eller hemska monster om inte barnet uttryckligen ber om det."
    ];

    // Anti-tropes / anti-moralbonanza
    const antiLines = [
      "UNDVIK:",
      "- Klyschor som 'han hörde en röst bakom sig' eller 'ett mystiskt ljus uppenbarade sig' om barnet inte själv har bett om det.",
      "- Att alltid hitta skatter, kistor eller magiska portaler i varje kapitel.",
      "- Långa moralkakor där du förklarar lärdomen i flera meningar.",
      "VISA istället mod, vänskap och lärande genom handlingar och dialog."
    ];

    // Sport-specifikt (om relevant)
    const childIdeaLower = (childIdea || "").toLowerCase();
    let sportHint = "";
    if (
      childIdeaLower.includes("fotboll") ||
      childIdeaLower.includes("hockey") ||
      childIdeaLower.includes("basket") ||
      childIdeaLower.includes("sport")
    ) {
      sportHint =
        "Om berättelsen handlar om sport: blanda in vardag runt sporten (kompisar, familj, skola, känslor) istället för att beskriva bara matchen sekund för sekund.";
    }

    const lp = lengthPreset;

    const lines = [
      `Du är BN-KIDS berättelsemotor (${ENGINE_VERSION}).`,
      `Du skriver på naturlig, korrekt svenska för målgruppen ${ageBand.label}.`,
      "",
      "ÖVERGRIPANDE UPPDRAG:",
      mode === "chapter_book"
        ? "Skriv nästa kapitel i en barn-/ungdomsbok med tydlig röd tråd."
        : "Skriv en fristående saga med tydlig början, mitt och slut.",
      "",
      "BARNETS IDÉ / ÖNSKEMÅL (detta styr berättelsen):",
      childIdea
        ? `- "${childIdea}"`
        : "- (ingen specifik extra önskan, bygg berättelsen kring hjälten och situationen).",
      "",
      "HJÄLTE:",
      `- Huvudpersonen heter ${hero} och ska konsekvent kallas "${hero}".`,
      "",
      "ÅLDER & TON:",
      `- Målgrupp: ${ageBand.label}.`,
      `- Anpassa språk, svårighetsgrad och teman till denna åldersgrupp.`,
      ...toneLines.map((t) => "- " + t),
      "",
      "LÄNGD:",
      `- Sikta på ungefär ${ageBand.chapter_words_target} ord.`,
      `- Försök hålla dig inom intervallet ${lp.min}–${lp.max} ord.`,
      "- Det är viktigare att kapitlet känns komplett än att det är superlångt.",
      "",
      "STRUKTUR FÖR KAPITLET:",
      ...structureInstr.map((t) => "- " + t),
      "- Avsluta alltid med en fullständig mening.",
      "",
      focusLines.join("\n"),
      "",
      antiLines.join("\n"),
      "",
      sportHint ? "SPORTHINT:\n- " + sportHint : "",
      "",
      "TIDIGARE HÄNDELSER (för dig som författare):",
      recapText
        ? "Kort sammanfattning av vad som hänt hittills (använd detta för att hålla logiken, men upprepa det inte ord för ord):\n" +
          recapText
        : isFirstChapter
        ? "Det finns inga tidigare kapitel. Detta är starten på berättelsen."
        : "Tidigare kapitel finns, men ingen sammanfattning skickas. Du måste ändå fortsätta logiskt från tidigare händelser.",
      "",
      "VIKTIGT OM STIL:",
      "- Skriv sceniskt med konkreta händelser, dialog och känslor.",
      "- Visa utveckling i hur hjälten agerar, inte bara i vad hen tänker om och om igen.",
      "- Undvik att upprepa exakt samma tanke eller formulering i varje stycke.",
      "",
      "SVARSFORMAT:",
      "Svara med bara själva kapiteltexten i ren text. Ingen JSON, inga metadata."
    ];

    return lines.join("\n");
  }

  // ------------------------------------------------------------
  // Extrahera text från API-svar (OpenAI/Mistral-kompatibelt)
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
  // HUVUD: generateChapter
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
    const ageBand = pickAgeBand(meta);
    const lengthPreset = resolveLengthPreset(meta, ageBand.id);

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

    const apiRaw = await callApi(apiUrl, payload);
    const modelText = extractModelText(apiRaw);

    let chapterText = modelText || "";

    // Trimma efter maxChars (~6 tecken/ord)
    const maxChars = (ageBand.chapter_words_max || 1600) * 6;
    chapterText = trimToWholeSentence(chapterText.slice(0, maxChars));

    return {
      chapterText,
      storyState: storyState || {},
      engineVersion: ENGINE_VERSION,
      ageBand
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
