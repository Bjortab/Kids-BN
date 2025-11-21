// ===============================================================
// BN-KIDS — STORY ENGINE (DEV v10.1)
// - Fokuserar på 7–12 år (13–15 mappar tills vidare till 10–12-logik)
// - Tydligare kapitelröd tråd med utdrag från föregående kapitel
// - Bättre hantering av oförändrad prompt (fortsätt samma bok)
// - Mindre moralkaka, mer handling och känslor
//
// Exponeras som: window.BNStoryEngine
// Anropas från: generateStory_ip.js (IP-wrappern)
//
// Viktigt: story_engine.dev.js MÅSTE laddas före generateStory_ip.js
// ===============================================================

(function (global) {
  "use strict";

  const ENGINE_VERSION = "bn-story-engine-v10.1";

  // ------------------------------------------------------------
  // Hämta ev. konfig-JSON (BN_STORY_CONFIG)
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
    }
    // OBS: ingen separat teen_13_15 här – 13–15 mappas tills vidare
    // ner till mid_10_12 för stabilitet (se pickAgeBand).
  };

  // ------------------------------------------------------------
  // Bestäm age band + längd-info
  // ------------------------------------------------------------
  function pickAgeBand(meta) {
    const rawAge =
      (meta && (meta.ageValue || meta.age || meta.ageLabel)) || "";
    const m = String(rawAge).match(/(\d{1,2})/);
    const age = m ? parseInt(m[1], 10) : 11;

    // 13–15 mappar vi tills vidare till mid_10_12 – tonårsläget pausat
    let bandId;
    if (age <= 9) bandId = "junior_7_9";
    else bandId = "mid_10_12";

    const cfg =
      CFG_AGE_BANDS[bandId] ||
      FALLBACK_BANDS[bandId] ||
      FALLBACK_BANDS.mid_10_12;

    const target =
      (cfg && cfg.chapter_words_target) ||
      (cfg && cfg.chapter_words_min && cfg.chapter_words_max
        ? Math.round((cfg.chapter_words_min + cfg.chapter_words_max) / 2)
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
      maxChars: maxChars,
      tone: (cfg && cfg.tone) || "",
      violence_level: (cfg && cfg.violence_level) || "",
      romance_level: (cfg && cfg.romance_level) || ""
    };
  }

  // ------------------------------------------------------------
  // Bestäm längdpreset (Kort / Lagom / Lång)
  // ------------------------------------------------------------
  function resolveLengthPreset(meta, ageBandId) {
    const defaultPreset = "medium";
    const lp =
      (meta && (meta.lengthValue || meta.lengthPreset || meta.length)) ||
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
  // Tolka om barnet ber om ett avslut
  // ------------------------------------------------------------
  function detectWantsEnding(childIdeaRaw) {
    if (!childIdeaRaw) return false;
    const t = String(childIdeaRaw).toLowerCase();

    return (
      t.includes("avsluta") ||
      t.includes("avslut") ||
      t.includes("sista kapitlet") ||
      t.includes("sista kapitlet") ||
      t.includes("knyt ihop") ||
      t.includes("knut ihop") ||
      t.includes("gör ett slut") ||
      t.includes("gör slut på boken") ||
      t.includes("slutet på boken")
    );
  }

  // ------------------------------------------------------------
  // Plocka barnets idé (senaste) & ursprungs-idé
  // ------------------------------------------------------------
  function getChildIdea(worldState) {
    const meta = (worldState && worldState.meta) || {};
    return (
      worldState._userPrompt ||
      worldState.last_prompt ||
      meta.originalPrompt ||
      meta.initialPrompt ||
      ""
    );
  }

  function getInitialIdea(worldState) {
    const meta = (worldState && worldState.meta) || {};
    return (
      worldState.initial_prompt ||
      meta.initialPrompt ||
      meta.originalPrompt ||
      worldState._userPrompt ||
      ""
    );
  }

  // ------------------------------------------------------------
  // Hämta info om föregående kapitel (recap + utdrag)
  // ------------------------------------------------------------
  function getPreviousChapterData(worldState, chapterIndex, storyState) {
    const result = {
      recapText: "",
      lastExcerpt: "",
      lastChapterTitle: ""
    };

    if (!chapterIndex || chapterIndex <= 1) return result;

    const chapters = (worldState && worldState.chapters) || [];
    const prevIdx = chapterIndex - 2; // zero-based
    const prev = chapters[prevIdx];

    if (prev && typeof prev.text === "string") {
      const txt = prev.text.trim();
      if (txt) {
        // Lite sanering: inga radbrytnings-orgier
        const safe = txt.replace(/\s+/g, " ").trim();
        result.recapText = safe.slice(0, 400); // kort sammanfattning
        result.lastExcerpt = safe.slice(-900); // slutet av förra kapitlet
        if (typeof prev.title === "string") {
          result.lastChapterTitle = prev.title.trim();
        }
      }
    }

    // Fallback till ev. summary i storyState
    if (
      !result.recapText &&
      storyState &&
      typeof storyState.previousSummary === "string"
    ) {
      result.recapText = storyState.previousSummary.trim().slice(0, 400);
    }

    // Om vi bara har recap, använd slutet av den som "excerpt"
    if (!result.lastExcerpt && result.recapText) {
      result.lastExcerpt = result.recapText.slice(-400);
    }

    return result;
  }

  // ------------------------------------------------------------
  // Bygg systemprompt till modellen
  // ------------------------------------------------------------
  function buildPrompt(opts) {
    const { worldState, storyState, chapterIndex, ageBand, lengthPreset } =
      opts;

    const meta = worldState.meta || {};
    const hero = meta.hero || "hjälten";

    const childIdea = getChildIdea(worldState);
    const initialIdea = getInitialIdea(worldState);
    const wantsEnding = detectWantsEnding(childIdea);

    const mode =
      worldState.story_mode ||
      (chapterIndex > 1 ? "chapter_book" : "single_story");

    const isFirstChapter = chapterIndex === 1;

    const prevData = getPreviousChapterData(
      worldState,
      chapterIndex,
      storyState
    );
    const recapText = prevData.recapText;
    const lastExcerpt = prevData.lastExcerpt;

    // -------- Strukturinstruktioner ----------
    const structureInstr = [];

    if (mode === "chapter_book") {
      if (isFirstChapter) {
        structureInstr.push(
          "Detta är kapitel 1 i en kapitelbok.",
          "Etablera huvudpersonen, miljön och den huvudsakliga konflikten.",
          "Avsluta med att något viktigt återstår eller att ett större äventyr väntar.",
          "Lös inte hela huvudkonflikten i första kapitlet."
        );
      } else if (wantsEnding) {
        structureInstr.push(
          `Detta är kapitel ${chapterIndex} och BOKEN SKA AVSLUTAS i detta kapitel.`,
          "Fortsätt direkt från slutet av förra kapitlet.",
          "Lös huvudkonflikten och knyt ihop de viktigaste trådarna.",
          "Starta inte en ny berättelse, inga helt nya huvudfiender eller helt nya världar i slutet.",
          "Avsluta på ett sätt som känns tillfredsställande för målgruppen, utan lång moralpredikan."
        );
      } else {
        structureInstr.push(
          `Detta är kapitel ${chapterIndex} i en pågående kapitelbok.`,
          "Fortsätt från slutet av förra kapitlet, starta inte om samma händelser igen.",
          "Använd det som redan hänt som grund för vad som händer nu.",
          "Låt hjältens tidigare val och lärdomar påverka kapitlet.",
          "Avsluta gärna med en ny krok eller fråga som leder vidare mot nästa kapitel."
        );
      }
    } else {
      // single_story
      if (wantsEnding) {
        structureInstr.push(
          "Detta är en fristående saga som ska AVSLUTAS i denna text.",
          "Lös den viktigaste konflikten och knyt ihop de viktigaste händelserna.",
          "Starta inte en ny berättelse på slutet."
        );
      } else {
        structureInstr.push(
          "Detta är en fristående saga.",
          "Ge berättelsen en tydlig början, mitt och slut.",
          "Se till att huvudkonflikten faktiskt får en lösning."
        );
      }
    }

    // -------- Toninstruktioner ----------
    const toneLines = [];
    if (ageBand.tone) toneLines.push(`Ton: ${ageBand.tone}.`);
    if (ageBand.violence_level) {
      toneLines.push(
        "Våldsnivå: håll allt på nivå " +
          ageBand.violence_level +
          ", inget grafiskt eller brutalt våld."
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

    // -------- Barnets idé(er) ----------
    const childIdeaLines = [];

    if (initialIdea && initialIdea !== childIdea) {
      childIdeaLines.push(
        "Barnets ursprungliga grundidé för boken:",
        `- "${initialIdea}"`,
        "",
        "Barnets nuvarande önskan för detta kapitel (ska tolkas som en fortsättning, inte en ny bok):",
        childIdea
          ? `- "${childIdea}"`
          : "- (ingen extra önskan uttryckt här)."
      );
    } else {
      childIdeaLines.push(
        "Barnets idé / önskan för berättelsen:",
        childIdea
          ? `- "${childIdea}"`
          : "- (ingen specifik extra önskan, bygg vidare på hjälten och läget)."
      );
    }

    // -------- Logik-rails ----------
    const railsLines = [
      "LOGIK-REGLER (viktigt):",
      "- Fortsätt berättelsen logiskt från tidigare händelser.",
      "- Starta inte om historien och byt inte magiska regler utan tydlig orsak.",
      "- Om någon figur har lärt sig något tidigare (t.ex. flyga, spruta eld, spela fotboll),",
      "  får hen inte plötsligt bli nybörjare igen utan att berättelsen förklarar varför.",
      "- Undvik upprepade moralkakor och långa tal om \"vad som är viktigt i livet\".",
      "- Visa hellre mod, vänskap och lärande genom vad som händer än genom predikningar.",
      "- Du får gärna ha värme och hopp, men utan att upprepa samma budskap om och om igen."
    ];

    // -------- Historia hittills ----------
    const historyLines = [];
    if (isFirstChapter) {
      historyLines.push(
        "Tidigare kapitel: det finns inga tidigare kapitel, detta är starten på berättelsen."
      );
    } else if (recapText || lastExcerpt) {
      historyLines.push(
        "Tidigare kapitel (du måste fortsätta härifrån, inte börja om):"
      );
      if (recapText) {
        historyLines.push(
          "",
          "Kort sammanfattning av vad som hänt hittills:",
          recapText
        );
      }
      if (lastExcerpt) {
        historyLines.push(
          "",
          "Utdrag från slutet av förra kapitlet (fortsätt direkt efter detta):",
          lastExcerpt
        );
      }
    } else {
      historyLines.push(
        "Tidigare kapitel finns, men ingen extra text skickas. Utgå ändå från att berättelsen redan är igång.",
        "Du får INTE starta en helt ny berättelse, utan ska fortsätta historien framåt."
      );
    }

    // -------- Bygg hela prompten ----------
    const lines = [
      `Du är BN-KIDS sagomotor (${ENGINE_VERSION}).`,
      `Du skriver på naturlig, korrekt svenska anpassad för målgruppen ${ageBand.label}.`,
      "",
      "ÖVERGRIPANDE UPPDRAG:",
      mode === "chapter_book"
        ? "Skriv nästa kapitel i en barn-/ungdomsbok med tydlig röd tråd."
        : "Skriv en fristående saga med tydlig början, mitt och slut.",
      "",
      ...childIdeaLines,
      "",
      "HJÄLTE:",
      `- Huvudpersonen heter ${hero} och ska konsekvent kallas \"${hero}\".`,
      "",
      "MÅLGRUPP & TON:",
      `- Målgrupp: ${ageBand.label}.`,
      `- Kapitlet ska kännas anpassat till denna ålder (språk, längd, tema).`,
      ...toneLines.map((t) => "- " + t),
      "",
      "LÄNGD:",
      `- Sikta på ungefär ${ageBand.wordGoal} ord.`,
      `- Försök hålla dig inom intervallet ${lp.min}–${lp.max} ord.`,
      "- Det är viktigare att kapitlet/sagan känns komplett än att den är exakt ett visst antal ord.",
      "",
      "STRUKTUR FÖR DETTA KAPITEL:",
      ...structureInstr.map((t) => "- " + t),
      "- Avsluta alltid med en fullständig mening (ingen avklippt mening på slutet).",
      "",
      ...railsLines,
      "",
      "BERÄTTELSENS HISTORIA HITTILLS:",
      ...historyLines,
      "",
      "SVARSFORMAT:",
      "Svara endast med själva texten till kapitlet/sagan.",
      "Inga rubriker som \"Kapitel X\", inga listor, ingen metadata, bara löpande brödtext."
    ];

    return lines.join("\n");
  }

  // --- Fortsättning i BLOCK 2 (extractModelText, callApi, generateChapter, export) ---
   // ------------------------------------------------------------
  // Hämta text från API-svar (OpenAI/Mistral kompatibelt)
  // ------------------------------------------------------------
  function extractModelText(apiResponse) {
    if (!apiResponse) return "";
    if (typeof apiResponse === "string") return apiResponse;
    if (typeof apiResponse.text === "string") return apiResponse.text;
    if (typeof apiResponse.story === "string") return apiResponse.story;

    // OpenAI / Mistral / OpenRouter format
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
      /* ignore */
    }

    return JSON.stringify(apiResponse);
  }

  // ------------------------------------------------------------
  // API-anropet
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
  // HUVUDMOTORN – GENERATE CHAPTER
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

    // --- Bygg prompten
    const prompt = buildPrompt({
      worldState,
      storyState,
      chapterIndex,
      ageBand,
      lengthPreset
    });

    // --- Skicka till API:n
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

    // Trimma längd och klipp av till hel mening
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
