// ===============================================================
// BN-KIDS — STORY ENGINE (GC v10.4)
// ---------------------------------------------------------------
// - Följer barnets prompt hårdare (Focus Lock Engine-light).
// - Bygger berättelsebåge för kapitelbok (plan ~8–12 kapitel).
// - Skiljer på start/mitt/slut-kapitel så allt inte händer i kap 1.
// - Åldersband: 7–9 (junior) och 10–12 (mid) aktiva nu.
// - Mindre moral-bonanza, mer handling som visar känslor.
// - Bättre stöd för crush/romantik 10–12, vänskap 7–9.
//
// Exponeras som: window.BNStoryEngine
// Används av: generate_story.dev.js / generateStory_ip.js
//
// Viktigt: API-signaturn är OFÖRÄNDRAD mot tidigare GC-versioner:
//   BNStoryEngine.generateChapter({ apiUrl, worldState, storyState, chapterIndex })
//   -> { chapterText, storyState, engineVersion, ageBand }
//
// ===============================================================

(function (global) {
  "use strict";

  const ENGINE_VERSION = "bn-story-engine-gc-v10.4";

  // ------------------------------------------------------------
  // Hjälp: plocka fram BN_STORY_CONFIG om den finns
  // ------------------------------------------------------------
  const CONFIG = global.BN_STORY_CONFIG || {};
  const CFG_AGE_BANDS =
    (CONFIG.bn_kids_story_config && CONFIG.bn_kids_story_config.age_bands) || {};
  const CFG_LENGTH =
    (CONFIG.bn_kids_story_config && CONFIG.bn_kids_story_config.length_presets) ||
    {};

  // ------------------------------------------------------------
  // Fallback-agebands om JSON-konfig inte finns
  // ------------------------------------------------------------
  const FALLBACK_BANDS = {
    junior_7_9: {
      id: "junior_7_9",
      label: "7–9 år",
      chapter_words_target: 650,
      chapter_words_min: 450,
      chapter_words_max: 800,
      tone:
        "enkel, lekfull, trygg, korta meningar, konkreta bilder, lite humor, vardag nära barnet",
      violence_level: "none_soft",
      romance_level: "none"
    },
    mid_10_12: {
      id: "mid_10_12",
      label: "10–12 år",
      chapter_words_target: 1100,
      chapter_words_min: 800,
      chapter_words_max: 1500,
      tone:
        "äventyrlig men trygg, mer känslor och relationer, lite djupare tankar, fortfarande lättläst",
      violence_level: "soft_fantasy",
      romance_level: "crush_only"
    },
    teen_13_15: {
      // framtida band – används bara om konfig trycker in det
      id: "teen_13_15",
      label: "13–15 år (beta)",
      chapter_words_target: 1700,
      chapter_words_min: 1200,
      chapter_words_max: 2300,
      tone:
        "mer mogen, inre tankar, identitet, men fortfarande PG-13 och tryggt",
      violence_level: "low_ya",
      romance_level: "light_ya_pg13"
    }
  };

  // ------------------------------------------------------------
  // Beräkna age band + längd-info
  // ------------------------------------------------------------
  function pickAgeBand(meta) {
    const rawAge =
      (meta && (meta.ageValue || meta.age || meta.ageLabel)) || "";
    const m = String(rawAge).match(/(\d{1,2})/);
    const age = m ? parseInt(m[1], 10) : 11;

    let bandId;
    if (age <= 9) bandId = "junior_7_9";
    else if (age <= 12) bandId = "mid_10_12";
    else bandId = "teen_13_15";

    const cfg = CFG_AGE_BANDS[bandId] || FALLBACK_BANDS[bandId];

    const target =
      (cfg && cfg.chapter_words_target) ||
      (cfg && cfg.chapter_words_min && cfg.chapter_words_max
        ? Math.round((cfg.chapter_words_min + cfg.chapter_words_max) / 2)
        : 1000);

    // Grovt: ~6 tecken per ord
    const maxChars =
      (cfg && cfg.chapter_words_max ? cfg.chapter_words_max * 6 : target * 6);

    return {
      id: bandId,
      label: (cfg && cfg.label) || bandId,
      wordGoal: target,
      maxChars: maxChars,
      tone: (cfg && cfg.tone) || "",
      violence_level: (cfg && cfg.violence_level) || "",
      romance_level: (cfg && cfg.romance_level) || ""
    };
  }

  // ------------------------------------------------------------
  // Bestäm längdpreset (Kort / Lagom / Lång) om vi kan
  // ------------------------------------------------------------
  function resolveLengthPreset(meta, ageBandId) {
    const defaultPreset = "medium";
    const lp =
      (meta && (meta.lengthValue || meta.lengthPreset || meta.length)) ||
      defaultPreset;

    const presetKey =
      /kort/i.test(lp) ? "short" :
      /lång/i.test(lp) ? "long" :
      "medium";

    const bandKey = ageBandId || "mid_10_12";
    const preset =
      CFG_LENGTH[presetKey] &&
      CFG_LENGTH[presetKey].word_ranges_by_band &&
      CFG_LENGTH[presetKey].word_ranges_by_band[bandKey];

    if (!preset) {
      // Fallback: ungefärliga ordintervall
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
  // Serie-info / kapitelbåge (8–12 kapitel default)
  // ------------------------------------------------------------
  function getSeriesInfo(worldState, chapterIndex) {
    const meta = worldState && worldState.meta;
    const series = (meta && meta.series) || {};
    const mode = worldState.story_mode || "single_story";

    const plannedMin =
      typeof series.planned_min_chapters === "number"
        ? series.planned_min_chapters
        : 8;
    const plannedMax =
      typeof series.planned_max_chapters === "number"
        ? series.planned_max_chapters
        : 12;
    const targetTotal =
      typeof series.planned_target === "number"
        ? series.planned_target
        : Math.round((plannedMin + plannedMax) / 2);

    let arcPhase = "single";
    if (mode !== "chapter_book") {
      arcPhase = "single";
    } else if (chapterIndex <= 1) {
      arcPhase = "start";
    } else if (chapterIndex < targetTotal - 2) {
      arcPhase = "middle";
    } else if (chapterIndex < targetTotal) {
      arcPhase = "late";
    } else {
      arcPhase = "final_window";
    }

    return {
      mode,
      plannedMin,
      plannedMax,
      targetTotal,
      chapterIndex,
      arcPhase
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
  // Bygg recap-text
  // ------------------------------------------------------------
  function buildRecapText(storyState, chapterIndex) {
    if (!storyState || chapterIndex === 1) return "";

    if (typeof storyState.previousSummary === "string") {
      const s = storyState.previousSummary.trim();
      if (s) return s.slice(0, 900);
    }

    if (Array.isArray(storyState.previousChapters) && storyState.previousChapters.length > 0) {
      const last = storyState.previousChapters[storyState.previousChapters.length - 1];
      if (typeof last === "string") {
        return last.slice(0, 900);
      }
    }

    return "";
  }

  // ------------------------------------------------------------
  // Bygg systemliknande prompt till motorn
  // ------------------------------------------------------------
  function buildPrompt(opts) {
    const {
      worldState,
      storyState,
      chapterIndex,
      ageBand,
      lengthPreset,
      seriesInfo
    } = opts;

    const meta = worldState.meta || {};
    const hero = meta.hero || "hjälten";

    const childIdea =
      worldState._userPrompt ||
      worldState.last_prompt ||
      meta.originalPrompt ||
      "";

    const recapText = buildRecapText(storyState, chapterIndex);
    const isFirstChapter = chapterIndex === 1;
    const mode = seriesInfo.mode;

    // FLE: hårdare fokus på barnets prompt + huvudtema
    const focusLines = [
      "1. Du MÅSTE följa barnets prompt och huvudtema mycket noggrant.",
      "2. Du får inte byta genre, ton eller huvudmål på eget initiativ.",
      "3. Om barnet nämner ett yrke (t.ex. fotbollsspelare, detektiv) ska kapitlet kretsa runt det yrket eller uppdraget.",
      "4. Om barnet nämner ett objekt (t.ex. en drönare, magisk bok, flodhästarna) ska objektet/problemet vara centralt tills konflikten är löst.",
      "5. Om barnet beskriver fiender eller hot (t.ex. flodhästar som förstör allt i sin väg) ska hotet kännas på riktigt,",
      "   men lösas på ett barnvänligt sätt. Tvinga inte alltid fram att de 'bara ville leka' om barnet inte bad om det.",
      "6. Sidospår är tillåtna endast om de stödjer huvuduppdraget eller visar viktiga känslor hos huvudpersonen."
    ];

    // Tona moralpredikan
    const moralLines = [
      "1. Visa vänskap, mod och omtanke genom handlingar och dialog – inte genom att hålla långa föreläsningar i slutet.",
      "2. Du får skriva EN kort mening som sammanfattar känslan eller lärdomen, men undvik att alltid säga samma sak.",
      "3. Hoppa över klyschor som 'det viktigaste var vänskap' om du redan visat det i handlingen."
    ];

    // Romantik / crush – styr beroende på ålder
    const romanceLines = [];
    if (ageBand.id === "junior_7_9") {
      romanceLines.push(
        "- Ingen romantik. Fokus på vänskap, mod, trygghet och upptäckande."
      );
    } else if (ageBand.id === "mid_10_12") {
      romanceLines.push(
        "- Oskyldiga crush-känslor är okej om barnet antyder det (t.ex. pirr i magen, leenden, vilja att imponera).",
        "- Ingen kyss-scen, inga explicita kärleksförklaringar. Håll det subtilt, varmt och tryggt."
      );
    } else {
      romanceLines.push(
        "- Romantik måste alltid vara PG-13, trygg och respektfull, utan explicita beskrivningar."
      );
    }

    // Ålders-ton
    const toneLines = [];
    if (ageBand.tone) toneLines.push(`Ton: ${ageBand.tone}.`);
    if (ageBand.violence_level) {
      toneLines.push(
        "Våldsnivå: håll det på nivå " +
          ageBand.violence_level +
          ", inget grafiskt våld."
      );
    }
    if (ageBand.romance_level) {
      toneLines.push(
        "Romantiknivå (internt): " +
          ageBand.romance_level +
          " – se reglerna ovan för hur det får synas."
      );
    }

    // Kapitellogik baserat på serie-bågen
    const arc = seriesInfo;
    const arcLines = [];
    if (mode === "chapter_book") {
      arcLines.push(
        `Den här boken är planerad till ungefär ${arc.plannedMin}–${arc.plannedMax} kapitel.`,
        `Du skriver nu kapitel ${arc.chapterIndex}.`
      );
      if (arc.arcPhase === "start") {
        arcLines.push(
          "- Detta är ett START-kapitel.",
          "- Bygg upp världen och huvudpersonen i lugn takt.",
          "- Plantera huvudkonflikten och barnets idé, men lös inget stort problem ännu.",
          "- Du får ta några meningar i början till vardag, plats och känsla innan prompten aktiveras."
        );
      } else if (arc.arcPhase === "middle") {
        arcLines.push(
          "- Detta är ett MITTEN-kapitel.",
          "- Huvudmålet ska vara tydligt och aktivt.",
          "- Skapa hinder, delmål och små framsteg, men lös inte hela huvudkonflikten.",
          "- Håll tydlig röd tråd från tidigare kapitel."
        );
      } else if (arc.arcPhase === "late") {
        arcLines.push(
          "- Detta är ett SENT MITTEN-kapitel.",
          "- Konflikten ska kännas intensivare, men ännu inte helt löst.",
          "- Förbered marken för ett kommande upplösningskapitel."
        );
      } else if (arc.arcPhase === "final_window") {
        arcLines.push(
          "- Detta kapitel får gärna avsluta boken om användaren ber om det.",
          "- Knyt ihop alla viktiga trådar och lös huvudkonflikten tydligt.",
          "- Introducera inte ett helt nytt huvudproblem just nu."
        );
      }
    } else {
      arcLines.push(
        "Detta är en fristående saga (single_story).",
        "- Du ska skapa en komplett berättelse där huvudkonflikten löses i samma text."
      );
    }

    // Start/fras-variation
    const styleLines = [
      "1. Variera dina inledningar. Börja ibland med platsen, ibland med en tanke, ibland med ett citat.",
      "   Undvik att alltid börja med att hjärtat slår snabbare eller att någon står kvar på samma plats.",
      "2. Undvik att upprepa fraser som 'han hörde en röst bakom sig' i varje saga.",
      "3. Nämn inte huvudpersonens namn i nästan varje mening – använd 'han', 'hon', 'hen' där det är tydligt.",
      "4. Låt ungefär 60–70% av kapitlet kretsa runt huvudtemat (t.ex. fotboll, drönare, magisk bok),",
      "   och 30–40% runt vardag, känslor, dialog och små detaljer som gör världen levande."
    ];

    const lp = lengthPreset;

    // Tidigare händelser / recap
    let recapSection = "";
    if (mode === "chapter_book") {
      if (recapText) {
        recapSection =
          "KORT SAMMANFATTNING AV TIDIGARE KAPITEL (detta är historien som redan hänt och får inte skrivas om):\n" +
          recapText;
      } else if (isFirstChapter) {
        recapSection =
          "Det finns inga tidigare kapitel. Detta är starten på berättelsen.";
      } else {
        recapSection =
          "Tidigare kapitel finns, men ingen extra sammanfattning skickas. Du får INTE starta om historien – fortsätt logiskt framåt.";
      }
    } else {
      recapSection =
        "Detta är en fristående saga. Det finns inga tidigare kapitel att ta hänsyn till.";
    }

    // Bygg prompten
    const lines = [
      `Du är BN-KIDS berättelsemotor (${ENGINE_VERSION}).`,
      `Du skriver på naturlig, korrekt svenska för målgruppen ${ageBand.label}.`,
      "",
      "ÖVERGRIPANDE UPPDRAG:",
      mode === "chapter_book"
        ? "Skriv nästa kapitel i en barn/ungdomsbok med tydlig röd tråd mellan kapitlen."
        : "Skriv en fristående saga med tydlig början, mitt och slut.",
      "",
      "BARNETS IDÉ / ÖNSKEMÅL (detta måste du respektera, men du får bygga upp och fördjupa):",
      childIdea
        ? `- "${childIdea}"`
        : "- (ingen specifik extra önskan, bygg på hjälten, miljön och situationen).",
      "",
      "HJÄLTE:",
      `- Huvudpersonen heter ${hero} och ska konsekvent kallas "${hero}".`,
      "- Karaktärer får inte byta namn eller glömmas bort utan tydlig orsak.",
      "",
      "FOCUS LOCK ENGINE (hålla sig till barnets prompt och genre):",
      ...focusLines.map((t) => "- " + t),
      "",
      "ÅLDERSBAND & TON:",
      `- Målgrupp: ${ageBand.label}.`,
      `- Kapitlet ska kännas anpassat till denna ålder (språk, längd, tema).`,
      ...toneLines.map((t) => "- " + t),
      "- Håll dig inom barnvänliga ramar (ingen skräck, inget grafiskt våld).",
      "",
      "ROMANTIK / CRUSH (om relevant):",
      ...romanceLines.map((t) => "- " + t),
      "",
      "MORAL & BUDSKAP:",
      ...moralLines.map((t) => "- " + t),
      "",
      "KAPITELBÅGE:",
      ...arcLines.map((t) => "- " + t),
      "",
      "LÄNGD:",
      `- Sikta på ungefär ${ageBand.wordGoal} ord.`,
      `- Försök hålla dig inom intervallet ${lp.min}–${lp.max} ord.`,
      "- Det är viktigare att kapitlet känns komplett och engagerande än att det är exakt rätt längd.",
      "",
      "BERÄTTARSTIL & VARIATION:",
      ...styleLines.map((t) => "- " + t),
      "",
      "LOGIK & KONTINUITET:",
      "- Starta inte om samma händelse flera gånger. Fortsätt där förra kapitlet slutade.",
      "- Om en figur har lärt sig något tidigare (t.ex. flyga, använda superkraft, förstå en ny värld),",
      "  får hen inte plötsligt bli nybörjare igen utan tydlig orsak.",
      "- Fakta, namn, relationer och viktiga objekt ska vara konsekventa över kapitlen.",
      "",
      "TIDIGARE HÄNDELSER:",
      recapSection,
      "",
      "SVARSFORMAT:",
      "Svara med enbart kapiteltexten i ren text, utan JSON, rubriker eller markeringar.",
      "Avsluta kapitlet med en fullständig mening (ingen halv mening på slutet)."
    ];

    return lines.join("\n");
  }

  // ------------------------------------------------------------
  // Hämta text från API-svar (OpenAI/Mistral kompatibelt)
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

    // Sista fallback – bra för felsökning
    try {
      return JSON.stringify(apiResponse);
    } catch (_) {
      return "";
    }
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

    if (!worldState) throw new Error("BNStoryEngine: worldState saknas.");

    const meta = worldState.meta || {};

    const ageBand = pickAgeBand(meta);
    const lengthPreset = resolveLengthPreset(meta, ageBand.id);
    const seriesInfo = getSeriesInfo(worldState, chapterIndex);

    const prompt = buildPrompt({
      worldState,
      storyState,
      chapterIndex,
      ageBand,
      lengthPreset,
      seriesInfo
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
      chapterIndex,
      seriesInfo
    };

    const apiRaw = await callApi(apiUrl, payload);
    const modelText = extractModelText(apiRaw);

    let chapterText = modelText || "";

    // Trimma mot maxChars + hel mening
    chapterText = trimToWholeSentence(
      chapterText.slice(0, ageBand.maxChars)
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
