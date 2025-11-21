// ===============================================================
// BN-KIDS — STORY ENGINE (DEV v10.2)
// - Läser in barnets prompt ordentligt (även sanerad via IP-filtret)
// - Två aktiva åldersband: 7–9 (junior), 10–12 (mid)  [13–15 mappas till 10–12]
// - Kapitellogik: kapitelIndex styr fortsatt-flödet (inte prompten)
// - Trim: mindre moralkaka, olika nivå per ålder
//   * 7–9 år: lite moral ok, men inte tjatigt
//   * 10–12 år: ingen moral om inte barnet själv ber om det i prompten
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
  // Hämta konfig (om vi har BN_STORY_CONFIG)
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
  // (OBS: bara junior + mid är aktiva. Teen mappas till mid i praktiken.)
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
      // används inte direkt i v10.2, men finns kvar för framtiden
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
  // Hjälp: plocka barnets idé / önskemål ur worldState
  // ------------------------------------------------------------
  function getChildIdea(worldState) {
    if (!worldState) return "";
    const meta = worldState.meta || {};
    const ideaFromWorld =
      worldState._userPrompt ||
      worldState.last_prompt ||
      worldState.user_prompt ||
      "";
    const ideaFromMeta =
      meta.originalPrompt ||
      meta.childPrompt ||
      meta.idea ||
      "";
    const combined = String(ideaFromWorld || ideaFromMeta || "").trim();
    return combined;
  }

  // ------------------------------------------------------------
  // Beräkna age band + längd-info
  //  - 7–9  => junior_7_9
  //  - 10–12 => mid_10_12
  //  - 13–15 => mappas också till mid_10_12 i v10.2
  // ------------------------------------------------------------
  function pickAgeBand(meta) {
    const rawAge =
      (meta && (meta.ageValue || meta.age || meta.ageLabel)) || "";
    const m = String(rawAge).match(/(\d{1,2})/);
    const age = m ? parseInt(m[1], 10) : 10;

    let bandId;
    if (age <= 9) bandId = "junior_7_9";
    else {
      // 10–12, 13–15 -> mid_10_12 i v10.2
      bandId = "mid_10_12";
    }

    // försök ta från config, annars fallback
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

    // grovt: ~6 tecken per ord
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
  // Bestäm längdpreset (Kort / Lagom / Lång) om vi kan
  // ------------------------------------------------------------
  function resolveLengthPreset(meta, ageBandId) {
    const defaultPreset = "medium";
    const lpRaw =
      (meta &&
        (meta.lengthValue ||
          meta.lengthPreset ||
          meta.length)) ||
      defaultPreset;

    const presetKey = /kort/i.test(lpRaw)
      ? "short"
      : /lång/i.test(lpRaw)
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
      return {
        id: "medium",
        min: 800,
        max: 1600,
        label: "lagom"
      };
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
    if (!t) return t;
    const lastDot = Math.max(
      t.lastIndexOf("."),
      t.lastIndexOf("!"),
      t.lastIndexOf("?")
    );
    if (lastDot !== -1) return t.slice(0, lastDot + 1);
    return t;
  }

  // ------------------------------------------------------------
  // Hjälp: bestäm story mode (single_story / chapter_book)
  // ------------------------------------------------------------
  function getStoryMode(worldState, chapterIndex) {
    if (worldState && worldState.story_mode) {
      return worldState.story_mode;
    }
    // Om kapitelIndex > 1 är vi i en pågående bok, punkt.
    return chapterIndex > 1 ? "chapter_book" : "single_story";
  }

  // ------------------------------------------------------------
  // Moral-detektion (baserat på prompten)
  // ------------------------------------------------------------
  function promptWantsMoral(childIdea) {
    if (!childIdea) return false;
    const s = childIdea.toLowerCase();
    return (
      s.includes("lärdom") ||
      s.includes("moralen") ||
      s.includes("lära sig") ||
      s.includes("lära oss") ||
      s.includes("visa att") ||
      s.includes("hjälte") ||
      s.includes("superhjälte") ||
      s.includes("rädda världen") ||
      s.includes("hjälpa andra") ||
      s.includes("vänskap") ||
      s.includes("teamwork")
    );
  }

  // ------------------------------------------------------------
  // Moral-detektion i stycken
  // ------------------------------------------------------------
  function isMoralParagraph(p) {
    const lower = p.toLowerCase();
    return (
      lower.includes("det viktigaste är") ||
      lower.includes("det som betyder mest") ||
      lower.includes("lärdomen är") ||
      lower.includes("vi lärde oss att") ||
      lower.includes("de lärde sig att") ||
      lower.includes("den riktiga styrkan") ||
      lower.includes("den verkliga styrkan") ||
      lower.includes("vänskap är det viktigaste") ||
      lower.includes("vänskapen är det viktigaste") ||
      lower.includes("det handlar inte bara om att vinna") ||
      lower.includes("det viktigaste var inte") ||
      lower.includes("hjälte i vardagen") ||
      lower.includes("riktig hjälte") ||
      lower.includes("superhjälte") ||
      lower.includes("alla var vänner igen") ||
      lower.includes("alltid finnas där för varandra") ||
      lower.includes("det viktigaste är att vi har varandra") ||
      lower.includes("det viktigaste var att de var tillsammans")
    );
  }

  // ------------------------------------------------------------
  // Postprocess: trimma moralnivå beroende på ålder
  //  - 7–9: behåll max 1 moralstycke, släng resten
  //  - 10–12: släng alla moralstycken om barnet inte bett om moral
  // ------------------------------------------------------------
  function postProcessChapterText(
    inputText,
    ageBand,
    context
  ) {
    let text = inputText || "";
    if (!text) return text;

    const childIdea = context.childIdea || "";
    const wantsMoral = promptWantsMoral(childIdea);

    const bandId = ageBand && ageBand.id ? ageBand.id : "mid_10_12";

    // vi jobbar på stycken (=paragrafer) separerade av tomrad
    const paras = text.split(/\n\s*\n/);
    if (paras.length === 0) return text;

    // JUNIOR 7–9: lite moral är ok, men inte tjat
    if (bandId === "junior_7_9") {
      let moralKept = 0;
      const filtered = paras.filter((p) => {
        if (!isMoralParagraph(p)) return true;
        // behåll första moral-stycket (för lite trygghet), droppa resten
        if (moralKept === 0) {
          moralKept++;
          return true;
        }
        return false;
      });
      const out = filtered.join("\n\n").trim();
      return out || text;
    }

    // MID 10–12: hårdare filter
    if (bandId === "mid_10_12") {
      // Om barnet explicit ber om moral i prompten, rör inte texten.
      if (wantsMoral) {
        return text;
      }

      const filtered = paras.filter((p) => !isMoralParagraph(p));
      const out = filtered.join("\n\n").trim();
      // Om vi råkade rensa bort för mycket, fall tillbaka till original
      return out || text;
    }

    // default: inget extra
    return text;
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
      lengthPreset
    } = opts;

    const meta = worldState.meta || {};
    const hero = meta.hero || "hjälten";

    const childIdea = getChildIdea(worldState);
    const mode = getStoryMode(worldState, chapterIndex);
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

    const structureInstr = isFirstChapter
      ? [
          "Detta är kapitel 1 i berättelsen.",
          "Du ska etablera huvudpersonen, miljön och den huvudsakliga konflikten.",
          "Avsluta med att det finns mer att utforska, men lös inte hela huvudkonflikten."
        ]
      : [
          `Detta är kapitel ${chapterIndex} i en pågående kapitelbok.`,
          "DU FÅR INTE starta om berättelsen eller skriva ett nytt kapitel 1.",
          "Fortsätt exakt där förra kapitlet logiskt slutade.",
          "Återanvänd viktiga händelser och relationer från tidigare kapitel – låtsas att du själv skrev dem.",
          "Även om barnets nya önskan/prompt liknar den första idén eller är tom, ska du behandla den som ett TILLÄGG till berättelsen, inte en ny start.",
          "Om användaren ber om avslut på boken: knyt logiskt ihop huvudkonflikten men upprepa inte hela berättelsen."
        ];

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

    const lines = [
      `Du är BN-KIDS sagomotor (${ENGINE_VERSION}).`,
      `Du skriver på naturlig, korrekt svenska för målgruppen ${ageBand.label}.`,
      "",
      "ÖVERGRIPANDE UPPDRAG:",
      mode === "chapter_book"
        ? "Skriv nästa kapitel i en barn/ungdomsbok med tydlig röd tråd."
        : "Skriv en fristående saga med tydlig början, mitt och slut.",
      "",
      "BARNETS IDÉ / ÖNSKEMÅL (detta måste respekteras, men du får utveckla och fördjupa):",
      childIdea
        ? `- "${childIdea}"`
        : "- (ingen specifik extra önskan, bygg på hjälten och situationen).",
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
      "- Undvik överdriven predikan/moralkaka. Visa hellre lärandet i handling än i föreläsningar.",
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
    } catch (e) {
      // ignore
    }

    try {
      return JSON.stringify(apiResponse);
    } catch (e2) {
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
    const childIdea = getChildIdea(worldState);
    const mode = getStoryMode(worldState, chapterIndex);

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
      chapterIndex,
      mode
    };

    const apiRaw = await callApi(apiUrl, payload);
    const modelText = extractModelText(apiRaw);

    let chapterText = modelText || "";

    // Trimma mot maxChars + hel mening
    chapterText = trimToWholeSentence(
      chapterText.slice(0, ageBand.maxChars)
    );

    // Postprocess: moralnivå per ålder
    chapterText = postProcessChapterText(chapterText, ageBand, {
      childIdea,
      mode,
      chapterIndex
    });

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
