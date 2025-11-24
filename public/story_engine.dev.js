// ===============================================================
// BN-KIDS — STORY ENGINE (DEV v10.5)
// - Fokuslås (FLE): följer barnets prompt & tema mycket hårdare
// - Memory Spine: bär med sig mål, karaktärer, objekt mellan kapitel
// - Anti-restart: kapitel 2+ får inte börja som en helt ny bok/portal/etc
// - Mindre moralkaka, mindre skatt/kista/karta-spam
// - Anti-klyscha: "en röst bakom sig" tonas bort
//
// Exponeras som: window.BNStoryEngine
// Används av: generateStory_ip.js (IP-wrappern)
//
// Viktigt: story_engine.dev.js MÅSTE laddas före generateStory_ip.js
// ===============================================================

(function (global) {
  "use strict";

  const ENGINE_VERSION = "bn-story-engine-v10.5";

  // ------------------------------------------------------------
  // Hjälp: plocka fram BN_STORY_CONFIG om den finns
  // ------------------------------------------------------------
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
        "enkel, lekfull, trygg, korta meningar, konkreta bilder, lite humor",
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
        "äventyrlig men trygg, mer känslor och relationer, lite mer detaljer",
      violence_level: "soft_fantasy",
      romance_level: "crush_only"
    },
    teen_13_15: {
      id: "teen_13_15",
      label: "13–15 år",
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
      (cfg &&
      cfg.chapter_words_min &&
      cfg.chapter_words_max
        ? Math.round(
            (cfg.chapter_words_min + cfg.chapter_words_max) / 2
          )
        : 1000);

    // Grovt: ~6 tecken per ord
    const maxChars =
      cfg && cfg.chapter_words_max
        ? cfg.chapter_words_max * 6
        : target * 6;

    return {
      id: bandId,
      label: (cfg && cfg.label) || bandId,
      wordGoal: target,
      maxChars,
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
      (meta &&
        (meta.lengthValue || meta.lengthPreset || meta.length)) ||
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
  // Enkel post-process: städa bort vissa klyschor
  // ------------------------------------------------------------
  function postProcessText(text) {
    if (!text) return "";
    let t = String(text);

    // Anti-klyscha: "en röst bakom sig" → gör den mindre "creepy"
    const badRost = [
      /en\s+röst\s+bakom\s+sig/gi,
      /en\s+röst\s+bakom\s+honom/gi,
      /en\s+röst\s+bakom\s+henne/gi,
      /rösten\s+bakom\s+sig/gi
    ];
    badRost.forEach((re) => {
      t = t.replace(
        re,
        "en röst som hördes lite längre bort, på ett tryggt och tydligt sätt"
      );
    });

    return t;
  }

  // ------------------------------------------------------------
  // Memory Spine – bygg / uppdatera enkel ryggrad
  // ------------------------------------------------------------
  function buildMemorySpine(worldState, storyState, meta, childIdea) {
    const prevSpine =
      (storyState && storyState.memorySpine) || {};

    const hero = (meta && meta.hero) || "hjälten";

    // Huvudmål – ta gärna från worldState om det finns,
    // annars barnets prompt (första delen)
    const mainGoal =
      prevSpine.mainGoal ||
      (worldState && worldState.mainGoal) ||
      (meta && meta.mainGoal) ||
      (childIdea || "").slice(0, 180);

    const spine = {
      mainGoal: mainGoal || "",
      heroName: hero,
      // Dessa listor kan fyllas på av framtida logik / backend,
      // men vi håller dem i strukturen redan nu.
      characters:
        prevSpine.characters || [hero].filter(Boolean),
      importantItems:
        prevSpine.importantItems || [],
      importantPlaces:
        prevSpine.importantPlaces || [],
      unresolvedThreads:
        prevSpine.unresolvedThreads || [],
      lastUserPrompt: childIdea || prevSpine.lastUserPrompt || "",
      totalChapters: prevSpine.totalChapters || 0
    };

    return spine;
  }

  // ------------------------------------------------------------
  // Bygg systemprompt / "superprompt" för motorn
  // ------------------------------------------------------------
  function buildPrompt(opts) {
    const {
      worldState,
      storyState,
      chapterIndex,
      ageBand,
      lengthPreset
    } = opts;

    const meta = worldState.meta || {};
    const hero = meta.hero || "hjälten";

    // Barnets idé / önskemål
    const childIdea =
      worldState._userPrompt ||
      worldState.last_prompt ||
      meta.originalPrompt ||
      "";

    const mode =
      worldState.story_mode ||
      (chapterIndex > 1 ? "chapter_book" : "single_story");

    const isFirstChapter = chapterIndex === 1;

    // Försök känna av om barnet ber om avslut
    const wantsEnding =
      /avslut|knyt ihop|sista kapit/i.test(childIdea || "");

    // Recap
    let recapText = "";
    if (
      !isFirstChapter &&
      storyState &&
      typeof storyState.previousSummary === "string"
    ) {
      recapText = storyState.previousSummary.trim();
    } else if (
      !isFirstChapter &&
      storyState &&
      Array.isArray(storyState.previousChapters)
    ) {
      const last =
        storyState.previousChapters[
          storyState.previousChapters.length - 1
        ];
      if (last && typeof last === "string") {
        recapText = last.slice(0, 900);
      }
    }

    const memorySpine = buildMemorySpine(
      worldState,
      storyState,
      meta,
      childIdea
    );

    // Kapitelstruktur: olika regler för 1 / mellan / final
    let structureInstr;
    if (isFirstChapter) {
      structureInstr = [
        "Detta är kapitel 1 i berättelsen.",
        "Börja med en kort, vardaglig scen (hemma, skolan, i trädgården, i biblioteket) så vi lär känna huvudpersonen innan magin eller äventyret drar igång.",
        "Etablera huvudpersonen, miljön och huvudmålet på ett tydligt sätt.",
        "Bygg upp nyfikenhet, men lös inte hela huvudkonflikten.",
        "Avsluta gärna med en cliffhanger eller frågetecken som bjuder in till kapitel 2."
      ];
    } else if (wantsEnding) {
      structureInstr = [
        `Detta är ett avslutande kapitel (kapitel ${chapterIndex}).`,
        "Fortsätt direkt där förra kapitlet slutade. Starta inte om samma dag, samma bok, samma portal eller samma match.",
        "Knyt ihop huvudmålet i berättelsen (huvudkonflikten ska få en tydlig, barnvänlig lösning).",
        "Inga nya stora konflikter eller helt nya magiska system i sista kapitlet.",
        "Avsluta med en varm, lugn känsla — men undvik att skriva en lång moralkaka. Visa i stället i handling vad barnen har lärt sig."
      ];
    } else {
      structureInstr = [
        `Detta är kapitel ${chapterIndex} i en pågående kapitelbok.`,
        "Fortsätt från slutet av förra kapitlet, starta inte om berättelsen som om detta vore kapitel 1.",
        "Låt viktiga händelser från tidigare kapitel påverka vad som händer nu.",
        "Ge huvudpersonen ett tydligt delmål i detta kapitel (t.ex. hitta en ledtråd, lära sig något nytt, klara ett hinder).",
        "Skapa nya problem eller hinder, men bygg dem på huvudmålet och tidigare händelser.",
        "Avsluta med en känsla av att det finns mer att utforska."
      ];
    }

    // Ålders- och toninstruktion
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
          ", inget explicit innehåll."
      );
    }

    // Moral-justering
    let moralInstr = "";
    if (ageBand.id === "junior_7_9") {
      moralInstr =
        "Du får gärna ha en mild, trygg lärdom i slutet, men undvik att alltid skriva exakt samma budskap som 'det viktigaste är vänskap'. Variera dig och håll det kort.";
    } else if (ageBand.id === "mid_10_12") {
      moralInstr =
        "Undvik predikande moralkakor. Visa i stället vad huvudpersonen lär sig genom handling, dialog och val. En kort antydan räcker.";
    } else {
      moralInstr =
        "Ingen moralkaka. Låt läsaren förstå vad som hänt genom handling och känslor, inte genom föreläsningar.";
    }

    const lp = lengthPreset;

    // Stilfilter / NO-GOs
    const styleFilters = [
      "Använd inte klyschan 'en röst bakom sig' eller liknande. Om någon ropar på huvudpersonen, beskriv det på ett tryggt och tydligt sätt.",
      "Återanvänd inte samma startmall i varje kapitel (t.ex. 'Björn stod vid kanten av...' eller 'Det var en solig dag...'). Variera dina inledningar.",
      "Låt inte varje kapitel handla om skattkistor, kartor, portaler eller glittrande föremål om barnet inte uttryckligen ber om det.",
      "Använd huvudpersonens namn ibland, men inte i varje mening. Variera med 'han', 'hon', 'hen', 'vännen', 'de' etc.",
      "Håll dig borta från mörk skräck, demonliknande figurer eller hotfulla skuggor om barnet inte specifikt ber om det."
    ];

    // Memory Spine text
    const spineLines = [];
    if (memorySpine.mainGoal) {
      spineLines.push(
        "- Huvudmål i berättelsen: " + memorySpine.mainGoal
      );
    }
    if (Array.isArray(memorySpine.characters)) {
      const chars = memorySpine.characters.join(", ");
      if (chars) {
        spineLines.push("- Viktiga karaktärer hittills: " + chars);
      }
    }
    if (Array.isArray(memorySpine.importantItems) &&
      memorySpine.importantItems.length > 0) {
      spineLines.push(
        "- Viktiga föremål hittills: " +
          memorySpine.importantItems.join(", ")
      );
    }
    if (
      Array.isArray(memorySpine.unresolvedThreads) &&
      memorySpine.unresolvedThreads.length > 0
    ) {
      spineLines.push(
        "- Saker som ännu inte är lösta: " +
          memorySpine.unresolvedThreads.join(", ")
      );
    }

    const lines = [
      `Du är BN-KIDS berättelsemotor (${ENGINE_VERSION}).`,
      `Du skriver på naturlig, korrekt svenska för målgruppen ${ageBand.label}.`,
      "",
      "ÖVERGRIPANDE UPPDRAG:",
      mode === "chapter_book"
        ? "Skriv nästa kapitel i en barn/ungdomsbok med tydlig röd tråd."
        : "Skriv en fristående saga med tydlig början, mitt och slut.",
      "",
      "FOKUSLÅS (FLE) — följ barnets idé:",
      "1. Följ barnets prompt och tema mycket noggrant.",
      "2. Byt inte genre, ton eller huvudtema på eget initiativ.",
      "3. Om barnet nämner ett yrke (t.ex. fotbollsspelare, detektiv) ska berättelsen kretsa kring det yrket hela kapitlet.",
      "4. Om barnet nämner ett viktigt föremål (t.ex. en magisk bok, drönare, nyckel) ska det föremålet vara centralt tills konflikten är löst.",
      "",
      "BARNETS IDÉ / ÖNSKEMÅL:",
      childIdea
        ? `- "${childIdea}"`
        : "- (ingen specifik extra önskan, bygg på hjälten och situationen).",
      "",
      "HJÄLTE:",
      `- Huvudpersonen heter ${hero} och ska konsekvent kallas "${hero}".`,
      "",
      "MINNESRYGGRAD (MEMORY SPINE):",
      spineLines.length
        ? spineLines.join("\n")
        : "- Ingen extra information skickas, men du ska ändå hålla röd tråd.",
      "",
      "ÅLDER & TON:",
      `- Målgrupp: ${ageBand.label}.`,
      `- Kapitlet ska kännas anpassat till denna ålder (språk, längd, tema).`,
      ...toneLines.map((t) => "- " + t),
      "",
      "LÄNGD:",
      `- Sikta på ungefär ${ageBand.wordGoal} ord.`,
      `- Försök hålla dig inom intervallet ${lp.min}–${lp.max} ord.`,
      "- Det är viktigare att kapitlet känns komplett än att det är exakt rätt längd.",
      "",
      "KAPITELSTRUKTUR:",
      ...structureInstr.map((t) => "- " + t),
      "- Avsluta alltid kapitlet med en fullständig mening (ingen halv mening på slutet).",
      "",
      "LOGIK & KONTINUITET:",
      "- Starta inte om samma händelse eller samma dag i kapitel 2 och framåt.",
      "- Om en figur har lärt sig något tidigare (t.ex. flyga, spruta eld, spela match) får hen inte plötsligt bli nybörjare igen utan tydlig orsak.",
      "- Återanvänd karaktärer, platser och föremål som redan har introducerats, i stället för att hitta på helt nya i varje kapitel.",
      "- Om barnet ber om avslut (t.ex. 'avsluta' eller 'knyt ihop') ska du avsluta huvudkonflikten tydligt.",
      "",
      "MORAL & LÄRDOM:",
      "- " + moralInstr,
      "",
      "STILFILTER & NO-GOs:",
      ...styleFilters.map((t) => "- " + t),
      "",
      "TIDIGARE HÄNDELSER:",
      recapText
        ? "Kort sammanfattning av vad som hänt hittills:\n" + recapText
        : isFirstChapter
        ? "Det finns inga tidigare kapitel. Detta är starten på berättelsen."
        : "Tidigare kapitel finns, men ingen extra sammanfattning skickas. Du måste fortsätta logiskt framåt.",
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

    // Trimma mot maxChars + hel mening
    chapterText = trimToWholeSentence(
      chapterText.slice(0, ageBand.maxChars)
    );

    // Post-process (anti-klyscha m.m.)
    chapterText = postProcessText(chapterText);

    // Uppdatera Memory Spine (enkel counter)
    const memorySpine = buildMemorySpine(
      worldState,
      storyState,
      meta,
      worldState._userPrompt ||
        worldState.last_prompt ||
        meta.originalPrompt ||
        ""
    );
    memorySpine.totalChapters =
      (memorySpine.totalChapters || 0) + 1;

    const newStoryState = Object.assign({}, storyState, {
      memorySpine
    });

    return {
      chapterText,
      storyState: newStoryState,
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
