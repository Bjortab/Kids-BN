// ===============================================================
// BN-KIDS — STORY ENGINE (DEV v10.2)
// - Läser in barnets prompt ordentligt (även sanerad via IP-filtret)
// - 2 aktiva åldersband: 7–9 och 10–12 (13–15 mappar till 10–12 tills vidare)
// - Kapitellogik: fortsätt där förra kapitlet slutade, inga "nytt kapitel 1"
// - Mindre moralkaka: visa lärande i handling, inte predikningar
//
// Exponeras som: window.BNStoryEngine
// Används av: generateStory_ip.js (IP-wrappern)
//
// Viktigt: story_engine.dev.js MÅSTE laddas före generateStory_ip.js
// ===============================================================

(function (global) {
  "use strict";

  const ENGINE_VERSION = "bn-story-engine-v10.2";

  // ------------------------------------------------------------
  // Hämta BN_STORY_CONFIG om den finns
  // ------------------------------------------------------------
  const CONFIG = global.BN_STORY_CONFIG || {};
  const CFG_ROOT = CONFIG.bn_kids_story_config || {};
  const CFG_AGE_BANDS = CFG_ROOT.age_bands || {};
  const CFG_LENGTH = CFG_ROOT.length_presets || {};

  // ------------------------------------------------------------
  // Fallback-agebands (om JSON-kramen saknas)
  // ------------------------------------------------------------
  const FALLBACK_BANDS = {
    junior_7_9: {
      id: "junior_7_9",
      label: "7–9 år",
      chapter_words_target: 650,
      chapter_words_min: 450,
      chapter_words_max: 800,
      tone: "enkel, lekfull, trygg, korta meningar, konkreta bilder, lite humor",
      violence_level: "none_soft",
      romance_level: "none"
    },
    mid_10_12: {
      id: "mid_10_12",
      label: "10–12 år",
      chapter_words_target: 1100,
      chapter_words_min: 800,
      chapter_words_max: 1500,
      tone: "äventyrlig men trygg, mer känslor och relationer, lite mer detaljer",
      violence_level: "soft_fantasy",
      romance_level: "crush_only"
    }
  };

  // ------------------------------------------------------------
  // Välj åldersband + maxlängd
  // ------------------------------------------------------------
  function pickAgeBand(meta) {
    const rawAge = (meta && (meta.actualAge || meta.ageValue || meta.age || meta.ageLabel)) || "";
    const m = String(rawAge).match(/(\d{1,2})/);
    const age = m ? parseInt(m[1], 10) : 11;

    let bandId;
    if (age <= 9) bandId = "junior_7_9";
    else bandId = "mid_10_12"; // 10–12 + allt över mappar hit i v1

    const cfgFromJson = CFG_AGE_BANDS[bandId];
    const cfg = cfgFromJson || FALLBACK_BANDS[bandId];

    const target =
      (cfg && cfg.chapter_words_target) ||
      (cfg && cfg.chapter_words_min && cfg.chapter_words_max
        ? Math.round((cfg.chapter_words_min + cfg.chapter_words_max) / 2)
        : 1000);

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
  // Bestäm längdpreset (kort / lagom / lång)
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
      // Fallback-intervall om JSON saknas
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
  // Trimma till hel mening
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
  // Bygg systemprompt
  // ------------------------------------------------------------
  function buildPrompt(opts) {
    const { worldState, storyState, chapterIndex, ageBand, lengthPreset } = opts;

    const meta = worldState.meta || {};
    const hero = meta.hero || "hjälten";

    // Barnets nuvarande idé för DETTA kapitel
    const childIdea =
      worldState._userPrompt ||
      worldState.last_prompt ||
      meta.originalPrompt ||
      "";

    const mode =
      worldState.story_mode ||
      (chapterIndex > 1 ? "chapter_book" : "single_story");

    const isFirstChapter = chapterIndex === 1;

    // ---------------- Recap ----------------
    let recapText = "";
    if (!isFirstChapter && storyState) {
      if (typeof storyState.previousSummary === "string") {
        recapText = storyState.previousSummary.trim();
      } else if (Array.isArray(storyState.previousChapters) && storyState.previousChapters.length > 0) {
        const last = storyState.previousChapters[storyState.previousChapters.length - 1];
        if (typeof last === "string") {
          recapText = last.slice(0, 900);
        }
      }
    }

    // ---------------- Struktur-instruktioner ----------------
    const structureInstr = isFirstChapter
      ? [
          "Detta är KAPITEL 1 i berättelsen.",
          "Etablera hjälten, miljön och huvudkonflikten.",
          "Avsluta med att det finns mer att utforska, men lös INTE hela huvudkonflikten."
        ]
      : [
          `Detta är KAPITEL ${chapterIndex} i en pågående kapitelbok.`,
          "Du MÅSTE fortsätta från slutet av förra kapitlet i samma tidslinje.",
          "Skriv INTE en ny version av första kapitlet. Starta inte om dagen, platsen eller konflikten utan tydlig anledning.",
          "Anta att läsaren redan känner hjälten och världen. Upprepa inte hela bakgrunden – bara kort om det verkligen behövs.",
          "Barnets nya idé beskriver vad som ska hända i det HÄR kapitlet, ovanpå allt som redan hänt.",
          "Väv in barnets idé som nästa steg, inte som en omstart.",
          "Låt viktiga händelser från tidigare kapitel påverka vad som händer nu.",
          "Om användaren ber om att avsluta boken: lös huvudkonflikten och ge ett tydligt, sammanhängande slut utan att skriva om alla kapitel från början."
        ];

    // ---------------- Ton / säkerhet ----------------
    const toneLines = [];
    if (ageBand.tone) toneLines.push(`Ton: ${ageBand.tone}.`);
    if (ageBand.violence_level) {
      toneLines.push(
        "Våldsnivå: håll det på nivå " + ageBand.violence_level + ", inget grafiskt våld."
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

    // ---------------- Prompt-text ----------------
    const lines = [
      `Du är BN-KIDS sagomotor (${ENGINE_VERSION}).`,
      `Du skriver på naturlig, korrekt svenska för målgruppen ${ageBand.label}.`,
      "",
      "ÖVERGRIPANDE UPPDRAG:",
      mode === "chapter_book"
        ? "Skriv nästa kapitel i en barn/ungdomsbok med tydlig röd tråd."
        : "Skriv en fristående saga med tydlig början, mitt och slut.",
      "",
      "BARNETS IDÉ / ÖNSKAN FÖR DETTA KAPITEL:",
      childIdea
        ? "- Behandla följande önskan som det som ska hända nu, i detta kapitel, ovanpå tidigare händelser."
        : "- Det finns ingen extra önskan, fortsätt bara logiskt från tidigare händelser.",
      childIdea
        ? `  "${childIdea}"`
        : "",
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
      "- Det är viktigare att kapitlet känns komplett och följer den röda tråden än att det är exakt rätt längd.",
      "",
      "STRUKTUR FÖR DETTA KAPITEL:",
      ...structureInstr.map((t) => "- " + t),
      "- Avsluta kapitlet med en fullständig mening (ingen halv mening).",
      "",
      "LOGIK & STIL:",
      "- Fortsätt samma tidslinje och samma huvudkonflikt.",
      "- Starta inte om samma händelse flera gånger.",
      "- Om en figur har lärt sig något tidigare (t.ex. flyga, spruta eld, spela match),",
      "  får hen inte plötsligt bli total nybörjare igen utan tydlig orsak i storyn.",
      "- Använd inte överdriven moralkaka eller långa predikningar.",
      "- Visa hellre lärandet genom vad barnen gör, säger och känner i själva händelserna.",
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
  // Plocka text från API-svar (OpenAI/Mistral kompatibelt)
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
      // ignorera
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
  // HUVUDFUNKTION: generateChapter
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

    const prompt = buildPrompt({
      worldState,
      storyState,
      chapterIndex,
      ageBand,
      lengthPreset
    });

    const payload = {
      prompt,
      age: meta.actualAge || meta.ageValue || meta.age || "",
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
