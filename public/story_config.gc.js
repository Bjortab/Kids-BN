// ============================================================
// BN-KIDS — STORY CONFIG (GC v1.0)
// Konfiguration för åldersband, längdpresets m.m.
// Görs tillgänglig som window.BN_STORY_CONFIG
// Används av: story_engine.gc.js
// ============================================================

(function (global) {
  "use strict";

  const BN_STORY_CONFIG = {
    bn_kids_story_config: {
      description:
        "Konfig för BN-Kids: åldersband, längd och ton. Fokus 7–12 år (junior + mid).",

      // ------------------------------------------------------
      // Åldersband (övergripande)
      // ------------------------------------------------------
      age_bands: {
        junior_7_9: {
          id: "junior_7_9",
          label: "7–9 år",
          min_age: 7,
          max_age: 9,
          chapter_words_target: 650,
          chapter_words_min: 450,
          chapter_words_max: 800,
          tone:
            "lekfull, trygg, humoristisk, konkreta bilder, korta meningar",
          violence_level: "none_soft",
          romance_level: "none",
          allow_subplots: false,
          max_subplots: 0,
          max_pov_shifts: 1
        },
        mid_10_12: {
          id: "mid_10_12",
          label: "10–12 år",
          min_age: 10,
          max_age: 12,
          chapter_words_target: 1100,
          chapter_words_min: 800,
          chapter_words_max: 1500,
          tone:
            "äventyrlig men trygg, mer känslor och relationer, lite mer detaljer",
          violence_level: "soft_fantasy",
          romance_level: "crush_only",
          allow_subplots: true,
          max_subplots: 1,
          max_pov_shifts: 2
        },
        // Teen finns kvar för framtiden men används inte aktivt nu
        teen_13_15: {
          id: "teen_13_15",
          label: "13–15 år (framtida)",
          min_age: 13,
          max_age: 15,
          chapter_words_target: 1700,
          chapter_words_min: 1200,
          chapter_words_max: 2300,
          tone:
            "mer mogen, inre tankar, identitet, men fortfarande PG-13 och tryggt",
          violence_level: "low_ya",
          romance_level: "light_ya_pg13",
          allow_subplots: true,
          max_subplots: 2,
          max_pov_shifts: 3
        }
      },

      // ------------------------------------------------------
      // Längdpresets (kort / lagom / lång)
      // ------------------------------------------------------
      length_presets: {
        short: {
          id: "short",
          label: "Kort",
          description: "Ca 3–5 minuter.",
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
      }
    }
  };

  global.BN_STORY_CONFIG = BN_STORY_CONFIG;
})(window);
