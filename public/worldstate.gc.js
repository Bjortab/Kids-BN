// ======================================================================
// BN-KIDS — WORLDSTATE (GC v7.0)
// Stabil global state-maskin för kapitelböcker + single sagor.
//
// Fokus i v7:
// - Ny, ren nyckel i localStorage: "bnkids_ws_v7"
// - Auto-fix av mismatch mellan chapterIndex och previousChapters
// - Enkel API: load / reset / nextChapter / updatePrompt / addChapterToHistory / updateSummary / updateMeta
// - Legacy-nycklar rensas bort automatiskt (ingen mer Application → rensa manuellt)
//
// OBS: Ingen stil/moral/regler här – bara STATE.
// ======================================================================

(function (global) {
  "use strict";

  // Ny, ren nyckel för v7
  const STORAGE_KEY = "bnkids_ws_v7";

  // Gamla nycklar vi inte vill bära med oss längre
  const LEGACY_KEYS = [
    "bnkids_worldstate_gc_v6",
    "bn_kids_worldstate_v1",
    "bn_kids_worldstate_v2",
    "bn_kids_worldstate_v3",
    "bn_kids_worldstate_v4",
    "bn_kids_ws_book_v1",
    "bnkids_ws_v6",
    "bnkids_worldstate_gc_v5"
  ];

  const CURRENT_VERSION = 7;

  function defaultState() {
    return {
      version: CURRENT_VERSION,
      chapterIndex: 0,
      story_mode: "chapter_book",
      previousChapters: [],
      previousSummary: "",
      last_prompt: "",
      _userPrompt: "",
      meta: {
        hero: "",
        age: "",
        ageValue: "",
        ageLabel: "",
        length: "",
        lengthValue: "",
        lengthLabel: "",
        totalChapters: 8
      }
    };
  }

  function wipeLegacyKeys() {
    try {
      LEGACY_KEYS.forEach((key) => {
        try {
          localStorage.removeItem(key);
        } catch (e) {
          // svälj, inte kritiskt
        }
      });
    } catch (e) {
      console.warn("[WS v7] kunde inte rensa legacy-nycklar", e);
    }
  }

  function normalizeState(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== "object") return base;

    const merged = Object.assign({}, base, raw);

    // version-säkring – om version diffar → börja om
    if (merged.version !== CURRENT_VERSION) {
      return base;
    }

    if (!Array.isArray(merged.previousChapters)) {
      merged.previousChapters = [];
    }

    if (typeof merged.chapterIndex !== "number" || merged.chapterIndex < 0) {
      merged.chapterIndex = merged.previousChapters.length;
    }

    // Hårdlås: chapterIndex = antal sparade kapitel
    const count = merged.previousChapters.length;
    if (merged.chapterIndex !== count) {
      merged.chapterIndex = count;
    }

    if (!merged.meta || typeof merged.meta !== "object") {
      merged.meta = base.meta;
    } else {
      merged.meta = Object.assign({}, base.meta, merged.meta);
      if (
        typeof merged.meta.totalChapters !== "number" ||
        merged.meta.totalChapters <= 0
      ) {
        merged.meta.totalChapters = base.meta.totalChapters;
      }
    }

    if (typeof merged.last_prompt !== "string") merged.last_prompt = "";
    if (typeof merged._userPrompt !== "string") merged._userPrompt = "";
    if (typeof merged.previousSummary !== "string")
      merged.previousSummary = "";

    return merged;
  }

  // -----------------------------------------------------------
  // LocalStorage helpers
  // -----------------------------------------------------------

  function load() {
    wipeLegacyKeys();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const fresh = defaultState();
        save(fresh);
        return fresh;
      }
      const parsed = JSON.parse(raw);
      const normalized = normalizeState(parsed);
      // om normalizeState "nollade" state (p.g.a version) → spara tillbaka
      save(normalized);
      return normalized;
    } catch (err) {
      console.warn("[WS v7] load-fel → återställer", err);
      const fresh = defaultState();
      save(fresh);
      return fresh;
    }
  }

  function save(state) {
    try {
      const s = normalizeState(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch (err) {
      console.warn("[WS v7] save-fel", err);
    }
  }

  // -----------------------------------------------------------
  // API
  // -----------------------------------------------------------

  function reset() {
    wipeLegacyKeys();
    const s = defaultState();
    save(s);
    return load();
  }

  // Viktigt: chapterIndex baseras ALLTID på antal tidigare kapitel
  function nextChapter() {
    const s = load();
    const count = Array.isArray(s.previousChapters)
      ? s.previousChapters.length
      : 0;
    s.chapterIndex = count + 1;
    save(s);
  }

  function updatePrompt(newPrompt) {
    const s = load();
    const trimmed = String(newPrompt || "").trim();

    // Om prompten ändras → uppdatera last_prompt
    if (trimmed && trimmed !== s.last_prompt) {
      s.last_prompt = trimmed;
    }

    // _userPrompt = "just nu"-prompten (även om tom)
    s._userPrompt = trimmed;
    save(s);
  }

  function addChapterToHistory(text) {
    const s = load();
    if (text && typeof text === "string") {
      const trimmed = text.trim();
      if (trimmed) {
        if (!Array.isArray(s.previousChapters)) {
          s.previousChapters = [];
        }
        s.previousChapters.push(trimmed);
      }
    }
    // autolock: chapterIndex = antal kapitel i historiken
    s.chapterIndex = s.previousChapters.length;
    save(s);
  }

  function updateSummary(summaryText) {
    const s = load();
    s.previousSummary = summaryText || "";
    save(s);
  }

  function updateMeta(metaObj) {
    const s = load();
    const base = defaultState();
    s.meta = Object.assign({}, base.meta, s.meta || {}, metaObj || {});
    save(s);
  }

  // -----------------------------------------------------------
  // Exponera
  // -----------------------------------------------------------

  global.BNWorldState = {
    load,
    save,
    reset,
    nextChapter,
    updatePrompt,
    addChapterToHistory,
    updateSummary,
    updateMeta
  };

  console.log("worldstate.gc.js laddad (GC v7.0) – nyckel:", STORAGE_KEY);
})(window);
