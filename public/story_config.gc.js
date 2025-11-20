// ==========================================================
// BN-KIDS — story_config.gc.js (GC v9)
// Global konfiguration för åldersband, längder, ton och lägen.
// Exponeras som: window.BN_STORY_CONFIG
// ==========================================================

(function (global) {
  "use strict";

  const BN_STORY_CONFIG = {
    description: "Konfig för BN-Kids: tre åldersband, två lägen (saga/kapitelbok), längd- och ton-presets samt användarpreferenser.",

    modes: {
      single_story: {
        id: "single_story",
        label: "En enskild saga",
        description: "En komplett berättelse med början, mitt och slut i ett enda kapitel. Konflikten ska lösas i samma saga.",
        constraints: {
          must_resolve_main_conflict: true,
          allow_cliffhanger: false
        }
      },
      chapter_book: {
        id: "chapter_book",
        label: "Kapitelbok",
        description: "En längre berättelse uppdelad i flera kapitel, med en röd tråd som fortsätter från kapitel till kapitel.",
        constraints: {
          must_resolve_main_conflict: false,
          allow_cliffhanger: true
        }
      }
    },

    age_bands: {
      junior_7_9: {
        id: "junior_7_9",
        label: "7–9 år",
        min_age: 7,
        max_age: 9,
        chapter_words_target: 600,
        chapter_words_min: 450,
        chapter_words_max: 750,
        sentence_length_target: 14,
        paragraphs_min: 8,
        paragraphs_max: 16,
        allow_subplots: false,
        max_subplots: 0,
        max_pov_shifts: 1,
        tone: "lekfull, trygg, humoristisk",
        violence_level: "none_soft",
        romance_level: "none",
        target_complexity: 1,
        themes_allowed: [
          "vardagsäventyr",
          "vänskap",
          "familj",
          "skola",
          "magiska äventyr med låg risk"
        ],
        prompt_instructions: "Skriv på enkel, tydlig svenska för ett barn mellan 7 och 9 år. Korta meningar, konkret handling, lite inre tankar. Ingen romantik, inget grafiskt våld. Fokus på trygghet, humor och enkla känslor."
      },
      mid_10_12: {
        id: "mid_10_12",
        label: "10–12 år",
        min_age: 10,
        max_age: 12,
        chapter_words_target: 1100,
        chapter_words_min: 800,
        chapter_words_max: 1500,
        sentence_length_target: 18,
        paragraphs_min: 12,
        paragraphs_max: 24,
        allow_subplots: true,
        max_subplots: 1,
        max_pov_shifts: 2,
        tone: "äventyrlig men trygg, med känslor",
        violence_level: "soft_fantasy",
        romance_level: "crush_only",
        target_complexity: 2,
        themes_allowed: [
          "vänskap",
          "mod",
          "utanförskap",
          "enkla familjekonflikter",
          "äventyr",
          "mystik"
        ],
        prompt_instructions: "Skriv för ett barn mellan 10 och 12 år. Mer djup i känslor och relationer, men fortfarande barnvänligt. Tillåt en enkel subplot, men behåll fokus på huvudäventyret. Ingen vuxen romantik, bara oskyldig 'crush'-nivå om det passar."
      },
      teen_13_15: {
        id: "teen_13_15",
        label: "13–15 år",
        min_age: 13,
        max_age: 15,
        chapter_words_target: 1800,
        chapter_words_min: 1200,
        chapter_words_max: 2500,
        sentence_length_target: 20,
        paragraphs_min: 16,
        paragraphs_max: 30,
        allow_subplots: true,
        max_subplots: 2,
        max_pov_shifts: 3,
        tone: "mer mogen men fortfarande trygg",
        violence_level: "low_ya",
        romance_level: "light_ya_pg13",
        target_complexity: 3,
        themes_allowed: [
          "identitet",
          "vänskap och lojalitet",
          "första kärlek (oskyldig)",
          "svek och försoning",
          "större äventyr",
          "orättvisa och att stå upp för andra"
        ],
        prompt_instructions: "Skriv för en ung tonåring (13–15 år). Tillåt mer inre tankar, identitetsfrågor och känslomässigt djup, men håll allt på en trygg PG-13-nivå. Ingen explicit romantik, inget grafiskt våld."
      }
    },

    length_presets: {
      short: {
        id: "short",
        label: "Kort",
        description: "Ca 3–5 minuter läsning/lyssning.",
        word_ranges_by_band: {
          junior_7_9: { min: 400, max: 700 },
          mid_10_12: { min: 600, max: 900 },
          teen_13_15: { min: 800, max: 1100 }
        }
      },
      medium: {
        id: "medium",
        label: "Lagom",
        description: "Ca 7–10 minuter.",
        word_ranges_by_band: {
          junior_7_9: { min: 700, max: 1100 },
          mid_10_12: { min: 900, max: 1400 },
          teen_13_15: { min: 1100, max: 1700 }
        }
      },
      long: {
        id: "long",
        label: "Lång",
        description: "Ca 12–15 minuter.",
        word_ranges_by_band: {
          junior_7_9: { min: 1100, max: 1600 },
          mid_10_12: { min: 1400, max: 2000 },
          teen_13_15: { min: 1700, max: 2500 }
        }
      }
    },

    tone_presets: {
      cozy: {
        id: "cozy",
        label: "Mysig",
        prompt_hint: "Ton: mysig, varm och lugn. Passar bra till godnattsaga. Fokus på trygghet och relationer."
      },
      adventurous: {
        id: "adventurous",
        label: "Spännande",
        prompt_hint: "Ton: äventyrlig och spännande, men fortfarande barnvänlig. Konflikter får gärna finnas, men utan grafiskt våld."
      },
      funny: {
        id: "funny",
        label: "Rolig",
        prompt_hint: "Ton: humoristisk, lekfull och skruvad. Låt skämt och roliga situationer få ta plats utan att tappa den röda tråden."
      },
      mixed: {
        id: "mixed",
        label: "Blandning",
        prompt_hint: "Ton: blandning av mysigt, spännande och roligt. Berättelsen får gärna skifta mellan känslor, men undvik allt för mörka eller tunga teman."
      }
    },

    default_user_preferences: {
      length_preset: "medium",
      tone_preset: "mixed",
      allow_cliffhanger: false,
      narration_person: "third",
      complexity_override: null
    },

    // Exempel — används bara som dokumentation, inte i logiken direkt
    story_state_example_single: {
      description: "Exempel på worldstate/story_state för en fristående saga.",
      story_mode: "single_story",
      age_band: "mid_10_12",
      actual_age: 11,
      length_preset: "medium",
      tone_preset: "mixed",
      user_preferences: {
        allow_cliffhanger: false,
        narration_person: "third",
        complexity_override: null
      }
    },

    story_state_example_chapter_book: {
      description: "Exempel på worldstate/story_state för en kapitelbok.",
      story_mode: "chapter_book",
      age_band: "junior_7_9",
      actual_age: 8,
      length_preset: "short",
      tone_preset: "cozy",
      user_preferences: {
        allow_cliffhanger: true,
        narration_person: "third",
        complexity_override: null
      },
      book_meta: {
        planned_chapters: 10,
        current_chapter: 3,
        act_structure: "three_act",
        main_conflict: "Hjälten måste rädda sin vän.",
        subplots: [],
        previous_chapter_summary: "Kort sammanfattning av vad som hänt hittills."
      }
    }
  };

  global.BN_STORY_CONFIG = BN_STORY_CONFIG;

})(window);
