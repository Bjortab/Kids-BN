// ===============================================================
// BN-KIDS — STORY ENGINE (GC v9)
// Konfig-styrd sagomotor med åldersband, längd & ton.
//
// Viktiga punkter:
// - API är oförändrat: BNStoryEngine.generateChapter(opts)
//   opts = { apiUrl, worldState, storyState, chapterIndex }
// - Använder BN_STORY_CONFIG om den finns (story_config.gc.js),
//   annars fallbackar till enkla standardvärden.
// - Åldersband 7–9, 10–12, 13–15 får olika längd, ton och nivå.
// - Ingen spontan fakta: modellen ska förklara nya saker i scenen.
// - Fortfarande trim till hel mening + robust JSON-hantering.
//
// Exponeras globalt som: window.BNStoryEngine
// ===============================================================

(function (global) {
  "use strict";

  const ENGINE_VERSION = "bn-story-engine-v9";

  // --------------------------------------------------------------
  // Hämta global konfig eller fallback
  // --------------------------------------------------------------
  const CFG = (function getConfig() {
    if (global.BN_STORY_CONFIG) return global.BN_STORY_CONFIG;

    // Fallback om story_config.gc.js inte laddats
    return {
      age_bands: {
        junior_7_9: {
          id: "junior_7_9",
          label: "7–9 år",
          min_age: 7,
          max_age: 9,
          chapter_words_min: 450,
          chapter_words_max: 750,
          prompt_instructions:
            "Skriv på enkel, tydlig svenska för ett barn mellan 7 och 9 år. Korta meningar, konkret handling, lite inre tankar."
        },
        mid_10_12: {
          id: "mid_10_12",
          label: "10–12 år",
          min_age: 10,
          max_age: 12,
          chapter_words_min: 800,
          chapter_words_max: 1500,
          prompt_instructions:
            "Skriv för ett barn mellan 10 och 12 år. Mer djup i känslor och relationer, men fortfarande barnvänligt."
        },
        teen_13_15: {
          id: "teen_13_15",
          label: "13–15 år",
          min_age: 13,
          max_age: 15,
          chapter_words_min: 1200,
          chapter_words_max: 2500,
          prompt_instructions:
            "Skriv för en ung tonåring (13–15 år) med lite mer känslor och tankar, men trygg ton."
        }
      },
      length_presets: {
        short: {
          word_ranges_by_band: {
            junior_7_9: { min: 400, max: 700 },
            mid_10_12: { min: 600, max: 900 },
            teen_13_15: { min: 800, max: 1100 }
          }
        },
        medium: {
          word_ranges_by_band: {
            junior_7_9: { min: 700, max: 1100 },
            mid_10_12: { min: 900, max: 1400 },
            teen_13_15: { min: 1100, max: 1700 }
          }
        },
        long: {
          word_ranges_by_band: {
            junior_7_9: { min: 1100, max: 1600 },
            mid_10_12: { min: 1400, max: 2000 },
            teen_13_15: { min: 1700, max: 2500 }
          }
        }
      },
      tone_presets: {
        mixed: {
          prompt_hint:
            "Ton: blandning av mysigt, spännande och roligt. Undvik allt för mörka eller tunga teman."
        }
      },
      default_user_preferences: {
        length_preset: "medium",
        tone_preset: "mixed"
      }
    };
  })();

  // --------------------------------------------------------------
  // Hjälp: gissa faktisk ålder från worldState.meta
  // --------------------------------------------------------------
  function inferAge(meta) {
    if (!meta) return 11;
    const candidates = [meta.ageValue, meta.ageLabel, meta.age];
    for (let i = 0; i < candidates.length; i++) {
      const s = (candidates[i] || "").toString();
      const m = s.match(/(\d{1,2})/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n)) return n;
      }
    }
    return 11;
  }

  // --------------------------------------------------------------
  // Hjälp: välj åldersband-nyckel (junior_7_9 / mid_10_12 / teen_13_15)
  // --------------------------------------------------------------
  function pickAgeBandKey(age) {
    const bands = CFG.age_bands || {};
    const keys = Object.keys(bands);
    for (let i = 0; i < keys.length; i++) {
      const b = bands[keys[i]];
      if (!b) continue;
      if (typeof b.min_age === "number" && typeof b.max_age === "number") {
        if (age >= b.min_age && age <= b.max_age) return keys[i];
      }
    }
    // fallback
    if (age <= 9 && bands.junior_7_9) return "junior_7_9";
    if (age <= 12 && bands.mid_10_12) return "mid_10_12";
    if (bands.teen_13_15) return "teen_13_15";
    return keys[0] || "mid_10_12";
  }

  // --------------------------------------------------------------
  // Hjälp: tolka längd-preset från meta.lengthValue / label
  // --------------------------------------------------------------
  function inferLengthPreset(meta) {
    const def = (CFG.default_user_preferences || {}).length_preset || "medium";
    if (!meta) return def;

    const rawVal = (meta.lengthValue || meta.lengthLabel || "").toString().toLowerCase();

    if (!rawVal) return def;

    if (rawVal.includes("kort") || rawVal.includes("short")) return "short";
    if (rawVal.includes("lång") || rawVal.includes("long")) return "long";
    if (rawVal.includes("mellan") || rawVal.includes("medium") || rawVal.includes("lagom"))
      return "medium";

    return def;
  }

  // --------------------------------------------------------------
  // Hjälp: hämta ordspann för band + preset
  // --------------------------------------------------------------
  function getWordRangeFor(bandKey, lengthPreset) {
    const lpAll = CFG.length_presets || {};
    const lp = lpAll[lengthPreset] || lpAll.medium || null;
    if (!lp || !lp.word_ranges_by_band) {
      // fall back till age_band-min/max
      const band = (CFG.age_bands || {})[bandKey];
      if (band && band.chapter_words_min && band.chapter_words_max) {
        return {
          min: band.chapter_words_min,
          max: band.chapter_words_max
        };
      }
      return { min: 600, max: 1200 };
    }
    const wr = lp.word_ranges_by_band[bandKey];
    if (wr && typeof wr.min === "number" && typeof wr.max === "number") {
      return { min: wr.min, max: wr.max };
    }
    return { min: 600, max: 1200 };
  }

  // --------------------------------------------------------------
  // Hjälp: välj ton-preset
  // --------------------------------------------------------------
  function inferTonePreset(meta) {
    const def = (CFG.default_user_preferences || {}).tone_preset || "mixed";
    if (!meta) return def;
    const raw = (meta.tonePreset || "").toString().toLowerCase();
    if (!raw) return def;

    // ev. framtida stöd för UI-värden
    if (raw.includes("mys") || raw.includes("cozy")) return "cozy";
    if (raw.includes("rolig") || raw.includes("fun")) return "funny";
    if (raw.includes("spän") || raw.includes("äventyr") || raw.includes("advent")) return "adventurous";
    if (raw.includes("bland")) return "mixed";

    return def;
  }

  // --------------------------------------------------------------
  // Trimma bort halv mening mot slutet
  // --------------------------------------------------------------
  function trimToWholeSentence(text) {
    let t = (text || "").trim();
    if (!t) return t;
    const lastDot = Math.max(t.lastIndexOf("."), t.lastIndexOf("!"), t.lastIndexOf("?"));
    if (lastDot !== -1) return t.slice(0, lastDot + 1);
    return t;
  }

  // --------------------------------------------------------------
  // Bygg prompt utifrån worldState + config-baserad profil
  // --------------------------------------------------------------
  function buildPrompt(opts) {
    const { worldState, storyState, chapterIndex, ageBandKey, ageBand, wordRange, tonePresetId } = opts;

    const meta = (worldState && worldState.meta) || {};
    const hero = meta.hero || "hjälten";
    const ageLabel = ageBand && ageBand.label ? ageBand.label : (meta.ageLabel || "10–12 år");

    const basePromptInstr = (ageBand && ageBand.prompt_instructions) || "";
    const tonePreset = (CFG.tone_presets || {})[tonePresetId] || null;
    const toneHint = tonePreset && tonePreset.prompt_hint ? tonePreset.prompt_hint : "";

    const minWords = wordRange.min;
    const maxWords = wordRange.max;
    const targetWords = ageBand && ageBand.chapter_words_target
      ? ageBand.chapter_words_target
      : Math.round((minWords + maxWords) / 2);

    // Vi skickar worldState/storyState som JSON för kontext
    const wsJson = JSON.stringify(worldState || {}, null, 2);
    const ssJson = JSON.stringify(storyState || {}, null, 2);

    return [
      `Du är BN-KIDS sagomotor (${ENGINE_VERSION}).`,
      `Du skriver kapitel ${chapterIndex} i en berättelse för åldern ${ageLabel}.`,
      "",
      "VIKTIGA REGLER:",
      "- Skriv på naturlig, korrekt svenska.",
      "- Håll nivån anpassad till åldern: inga för svåra ord för yngre barn.",
      "- Inga floskler som 'äventyret hade bara börjat' eller 'detta var bara början'.",
      "- Använd logik: allt som händer ska ha en tydlig orsak i berättelsen.",
      "- Uppfinn INTE fakta som barnet inte har sagt eller som inte passar in i worldstate.",
      "- Om något nytt behöver få ett namn (t.ex. ett djur eller ett föremål), låt karaktärerna namnge det i scenen.",
      "- Om något ovanligt händer (t.ex. magi, speciella krafter, stjärnor i en tunnel) ska du förklara varför det kan ske.",
      "",
      "ÅLDERSANPASSNING:",
      basePromptInstr,
      "",
      "TON:",
      toneHint || "(neutral, varm barnbokston).",
      "",
      "LÄNGD:",
      `- Sikta på ungefär ${targetWords} ord.`,
      `- Minst ca ${minWords} ord och helst inte mer än ca ${maxWords} ord.`,
      "- Det är viktigare att kapitlet känns komplett och tydligt än att det blir exakt antal ord.",
      "",
      "STRUKTUR FÖR KAPITLET:",
      "1. 1–3 meningars recap som kort påminner om vad som hände i förra kapitlet.",
      "2. EN huvudscen där något nytt händer eller utvecklas.",
      "3. Lite dialog och känslor anpassade till åldern.",
      "4. En tydlig avslutning på kapitlet med en hel mening (ingen halv mening).",
      "",
      "KONTEXT (WORLDSTATE) — detta beskriver bokens värld, karaktärer och meta-data:",
      wsJson,
      "",
      "KONTEXT (STORYSTATE) — använd detta för att hålla ihop handlingen mellan kapitel:",
      ssJson,
      "",
      "VIKTIGT:",
      "- Fortsätt berättelsen framåt. Starta inte om boken från början.",
      "- Håll dig till de relationer, platser och regler som finns i worldstate/storystate.",
      "- Undvik att förändra hjälten helt utan förklaring (t.ex. supermodig i ett kapitel och livrädd i nästa).",
      "",
      "SVARSFORMAT:",
      "Du ska svara med en JSON-struktur:",
      '{ "chapterText": "...", "storyState": { ... } }',
      "",
      "chapterText ska vara ren text utan extra JSON inuti. storyState ska uppdateras om något viktigt förändras (t.ex. relationer, mål, hemligheter)."
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
  // API-anrop
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
  // HUVUDFUNKTION: generateChapter
  // --------------------------------------------------------------
  async function generateChapter(opts) {
    const {
      apiUrl = "/api/generate_story",
      worldState,
      storyState = {},
      chapterIndex = 1
    } = opts || {};

    if (!worldState) {
      throw new Error("BNStoryEngine.generateChapter: worldState saknas.");
    }

    const meta = worldState.meta || {};
    const age = inferAge(meta);
    const ageBandKey = pickAgeBandKey(age);
    const ageBand = (CFG.age_bands || {})[ageBandKey] || null;
    const lengthPreset = inferLengthPreset(meta);
    const wordRange = getWordRangeFor(ageBandKey, lengthPreset);
    const tonePresetId = inferTonePreset(meta);

    const prompt = buildPrompt({
      worldState,
      storyState,
      chapterIndex,
      ageBandKey,
      ageBand,
      wordRange,
      tonePresetId
    });

    const payload = {
      prompt,
      age: meta.ageValue || meta.age || age,
      hero: meta.hero,
      length: meta.lengthValue || meta.lengthLabel,
      engineVersion: ENGINE_VERSION,
      worldState,
      storyState,
      chapterIndex,
      ageBandKey,
      lengthPreset,
      tonePresetId
    };

    const apiRaw = await callApi(apiUrl, payload);
    const modelText = extractModelText(apiRaw);
    const json = extractJson(modelText);

    let chapterText;
    let newState;

    if (json && typeof json.chapterText === "string") {
      chapterText = json.chapterText;
      newState = json.storyState || storyState;
    } else {
      chapterText = modelText;
      newState = storyState;
    }

    // Trimma till hel mening och ungefär rätt maxlängd i tecken
    // (grov uppskattning: 5 tecken per ord → maxChars ≈ maxWords*6)
    const approxMaxChars = wordRange.max * 6;
    chapterText = trimToWholeSentence(
      (chapterText || "").slice(0, approxMaxChars)
    );

    return {
      chapterText,
      storyState: newState,
      engineVersion: ENGINE_VERSION,
      ageBandKey,
      lengthPreset,
      tonePresetId
    };
  }

  // --------------------------------------------------------------
  // Exponera mot global
  // --------------------------------------------------------------
  global.BNStoryEngine = {
    generateChapter,
    ENGINE_VERSION
  };

})(window);
