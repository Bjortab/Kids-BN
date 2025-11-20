// ===============================================================
// BN-KIDS — STORY ENGINE (DEV v9d)
// - Läser in barnets prompt ordentligt (även sanerad via IP-filtret)
// - Skiljer tydligare på 7–9, 10–12, 13–15 år
// - Kapitellogik bibehållen (kapitelIndex styr fortsatt-flödet)
// - Hanterar "samma prompt igen" som FORTSÄTT, inte omstart
// - Trim: inga moralkake-manus, fokus på handling + känslor
//
// Exponeras som: window.BNStoryEngine
// Används av: generateStory_ip.js (IP-wrappern)
//
// Viktigt: story_engine.dev.js MÅSTE laddas före generateStory_ip.js
// ===============================================================

(function (global) {
  "use strict";

  const ENGINE_VERSION = "bn-story-engine-v9d";

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
  // Hjälp: normalisera prompt för jämförelse
  // ------------------------------------------------------------
  function normalizePrompt(p) {
    if (!p) return "";
    return String(p)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

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
        ? Math.round(
            (cfg.chapter_words_min + cfg.chapter_words_max) / 2
          )
        : 1000);

    // Grovt: ~6 tecken per ord
    const maxChars =
      (cfg && cfg.chapter_words_max
        ? cfg.chapter_words_max * 6
        : target * 6);

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
      (meta &&
        (meta.lengthValue || meta.lengthPreset || meta.length)) ||
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
    const {
      worldState,
      storyState,
      chapterIndex,
      ageBand,
      lengthPreset,
      childIdeaRaw,
      promptMode
    } = opts;

    const meta = worldState.meta || {};
    const hero = meta.hero || "hjälten";

    const mode =
      worldState.story_mode ||
      (chapterIndex > 1 ? "chapter_book" : "single_story");

    const isFirstChapter = chapterIndex === 1;

    // Enkel recap-beskrivning
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
        recapText = last.slice(0, 800);
      }
    }

    // Instruktion för om vi är i kapitelbok
    const structureInstr = isFirstChapter
      ? [
          "Detta är kapitel 1 i berättelsen.",
          "Du ska etablera huvudpersonen, miljön och den huvudsakliga konflikten.",
          "Avsluta med att det finns mer att utforska, men lös inte hela huvudkonflikten."
        ]
      : [
          `Detta är kapitel ${chapterIndex} i en pågående kapitelbok.`,
          "Fortsätt från slutet av förra kapitlet, starta inte om samma dag eller samma konflikt.",
          "Låt viktiga händelser från tidigare kapitel påverka vad som händer nu.",
          "Om användaren ber om avslut på boken: knyt ihop huvudkonflikten men upprepa inte hela berättelsen."
        ];

    // Ålders- och toninstruktion
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
        "Romantik: högst nivå " +
          ageBand.romance_level +
          ", inget explicit innehåll."
      );
    }

    const lp = lengthPreset;

    // Text kring barnets idé beroende på promptMode
    const childIdea = childIdeaRaw || "";
    const childIdeaBlockLines = [];

    if (childIdea) {
      if (promptMode === "new_request") {
        childIdeaBlockLines.push(
          "Barnet har NU formulerat en ny önskan för detta kapitel. Du måste väva in denna idé på ett naturligt sätt i den pågående berättelsen utan att starta om."
        );
        childIdeaBlockLines.push(`- Nuvarande önskan: "${childIdea}"`);
      } else {
        // continue
        childIdeaBlockLines.push(
          "Barnet har INTE gett någon ny önskan denna gång. Använd samma övergripande idé som tidigare, men behandla den mest som tema i bakgrunden."
        );
        childIdeaBlockLines.push(
          "Fortsätt berättelsen logiskt framåt. Upprepa inte samma träningsmoment eller konflikt från föregående kapitel om det inte finns en tydlig ny vändning."
        );
        childIdeaBlockLines.push(`- Övergripande idé/tema: "${childIdea}"`);
      }
    } else {
      childIdeaBlockLines.push(
        "Det finns ingen specifik extra önskan från barnet just nu. Bygg vidare logiskt på hjälten, deras mål och det som hänt hittills."
      );
    }

    // Extra logikregler kopplade till promptMode
    const logicExtra = [];
    if (promptMode === "continue") {
      logicExtra.push(
        "- Behandla detta kapitel som en fortsättning: utveckla relationer, konflikter och mål från tidigare kapitel."
      );
      logicExtra.push(
        "- Låt huvudpersonen utvecklas. Om hjälten har blivit bättre på något (t.ex. fotboll, flyga, spruta eld), får hen inte plötsligt vara nybörjare igen utan en tydligt beskriven orsak."
      );
    } else {
      logicExtra.push(
        "- Barnet har ändrat eller förtydligat sin önskan. Anpassa berättelsen efter den nya idén utan att ignorera det som redan hänt."
      );
    }

    // Bygg prompten
    const lines = [
      `Du är BN-KIDS sagomotor (${ENGINE_VERSION}).`,
      `Du skriver på naturlig, korrekt svenska för målgruppen ${ageBand.label}.`,
      "",
      "ÖVERGRIPANDE UPPDRAG:",
      mode === "chapter_book"
        ? "Skriv nästa kapitel i en barn/ungdomsbok med tydlig röd tråd."
        : "Skriv en fristående saga med tydlig början, mitt och slut.",
      "",
      "BARNETS IDÉ / ÖNSKEMÅL:",
      ...childIdeaBlockLines.map((t) => "- " + t),
      "",
      "HJÄLTE:",
      `- Huvudpersonen heter ${hero} och ska konsekvent kallas "${hero}".`,
      "",
      "ÅLDER & TON:",
      `- Målgrupp: ${ageBand.label}.`,
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
      "- Undvik överdrivna moralkakor och upprepade föreläsningar. Visa lärandet genom vad som händer och hur barnen agerar.",
      ...logicExtra,
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

    const ageBand = pickAgeBand(meta);
    const lengthPreset = resolveLengthPreset(meta, ageBand.id);

    // Plocka fram barnets nuvarande idé
    const childIdeaRaw =
      worldState._userPrompt ||
      worldState.last_prompt ||
      meta.originalPrompt ||
      "";

    const childIdeaNorm = normalizePrompt(childIdeaRaw);
    const lastNorm =
      storyState && storyState.lastChildIdeaNorm
        ? String(storyState.lastChildIdeaNorm)
        : "";

    const promptMode =
      lastNorm && childIdeaNorm === lastNorm
        ? "continue"
        : "new_request";

    // Spara normerad idé i storyState för nästa anrop
    storyState.lastChildIdeaNorm = childIdeaNorm;
    storyState.lastChildIdeaRaw = childIdeaRaw;

    const prompt = buildPrompt({
      worldState,
      storyState,
      chapterIndex,
      ageBand,
      lengthPreset,
      childIdeaRaw,
      promptMode
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
    // Vi använder bara ren text, ingen JSON, i denna version

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
