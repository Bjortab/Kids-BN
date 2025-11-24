// ==========================================================
// BN-KIDS — BNWorldState (GC v4.0)
// - Håller koll på bokens state i localStorage
// - Används av ws_button.gc.js + backend /api/generate
//
// Struktur som sparas:
// {
//   meta: {
//     hero,
//     age,
//     ageValue,
//     ageLabel,
//     length,
//     lengthValue,
//     lengthLabel,
//     originalPrompt,
//     totalChapters
//   },
//   story_mode: "chapter_book",
//   chapterIndex: number,
//   last_prompt: string,
//   _userPrompt: string,
//   previousChapters: [string, ...],
//   previousSummary: string
// }
//
// Exponeras globalt som: window.BNWorldState
// ==========================================================

(function (global) {
  "use strict";

  const STORAGE_KEY = "bn_kids_worldstate_v4";

  function defaultState() {
    return {
      meta: {
        hero: "hjälten",
        age: "",
        ageValue: "",
        ageLabel: "7–8 år",
        length: "",
        lengthValue: "",
        lengthLabel: "Lagom",
        originalPrompt: "",
        totalChapters: 8 // standard 8 kapitel tills vi ev. ändrar i UI
      },
      story_mode: "chapter_book",
      chapterIndex: 0,
      last_prompt: "",
      _userPrompt: "",
      previousChapters: [],
      previousSummary: ""
    };
  }

  function safeParse(json) {
    try {
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = safeParse(raw);
      if (!parsed || typeof parsed !== "object") return defaultState();

      // Se till att obligatoriska fält finns
      if (!parsed.meta || typeof parsed.meta !== "object") {
        parsed.meta = defaultState().meta;
      }
      if (!Array.isArray(parsed.previousChapters)) {
        parsed.previousChapters = [];
      }
      if (typeof parsed.previousSummary !== "string") {
        parsed.previousSummary = "";
      }
      if (typeof parsed.chapterIndex !== "number") {
        parsed.chapterIndex = 0;
      }
      if (typeof parsed.last_prompt !== "string") {
        parsed.last_prompt = "";
      }
      if (typeof parsed._userPrompt !== "string") {
        parsed._userPrompt = parsed.last_prompt || "";
      }
      if (typeof parsed.story_mode !== "string") {
        parsed.story_mode = "chapter_book";
      }
      if (!parsed.meta.totalChapters) {
        parsed.meta.totalChapters = 8;
      }

      return parsed;
    } catch (e) {
      console.warn("[BNWorldState] kunde inte läsa state, återställer", e);
      return defaultState();
    }
  }

  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("[BNWorldState] kunde inte spara state", e);
    }
  }

  function reset() {
    const st = defaultState();
    save(st);
    return st;
  }

  function updateMeta(metaPatch) {
    const st = load();
    st.meta = Object.assign({}, st.meta, metaPatch || {});
    save(st);
    return st;
  }

  function updatePrompt(prompt) {
    const st = load();
    const p = (prompt || "").trim();
    st.last_prompt = p;
    st._userPrompt = p;
    if (!st.meta.originalPrompt) {
      st.meta.originalPrompt = p;
    }
    save(st);
    return st;
  }

  function nextChapter() {
    const st = load();
    if (!st.chapterIndex || st.chapterIndex < 1) {
      st.chapterIndex = 1;
    } else {
      st.chapterIndex += 1;
    }
    save(st);
    return st;
  }

  function addChapterToHistory(chapterText) {
    const st = load();
    if (!Array.isArray(st.previousChapters)) {
      st.previousChapters = [];
    }
    st.previousChapters.push(String(chapterText || ""));
    save(st);
    return st;
  }

  function updateSummary(summary) {
    const st = load();
    st.previousSummary = String(summary || "");
    save(st);
    return st;
  }

  // För felsökning vid behov
  function debugDump() {
    return load();
  }

  global.BNWorldState = {
    load,
    save,
    reset,
    updateMeta,
    updatePrompt,
    nextChapter,
    addChapterToHistory,
    updateSummary,
    debugDump
  };
})(window);
