// ======================================================================
// BN-KIDS — WORLDSTATE (GC v6.0)
// Stabil global state-maskin för kapitelböcker + single sagor.
//
// Viktigt:
//  - Sparar kapitelnummer, meta, summary och kapitelhistorik
//  - Förlorar ALDRIG kapiteltråden när prompten inte ändras
//  - Ger backend rätt context för GC v6 generate.js
//  - Ingen moral, ingen stil, inga regler här – bara state.
//
// ======================================================================

(function (global) {
  "use strict";

  const STORAGE_KEY = "bnkids_worldstate_gc_v6";

  const defaultState = () => ({
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
  });

  // -----------------------------------------------------------
  // LocalStorage helpers
  // -----------------------------------------------------------
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return Object.assign(defaultState(), parsed);
    } catch (err) {
      console.warn("[WS GC] load-fel → återställer", err);
      return defaultState();
    }
  }

  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("[WS GC] save-fel", err);
    }
  }

  // -----------------------------------------------------------
  // API
  // -----------------------------------------------------------

  function reset() {
    const s = defaultState();
    save(s);
    return load();
  }

  function nextChapter() {
    const s = load();
    s.chapterIndex = Number(s.chapterIndex || 0) + 1;
    save(s);
  }

  function updatePrompt(newPrompt) {
    const s = load();
    const trimmed = String(newPrompt || "").trim();

    // Viktigt: om samma prompt → ändra INTE last_prompt
    // annars tror AI:n att ny bok börjar.
    if (trimmed && trimmed !== s.last_prompt) {
      s.last_prompt = trimmed;
    }

    s._userPrompt = trimmed;
    save(s);
  }

  function addChapterToHistory(text) {
    const s = load();
    if (text && typeof text === "string") {
      s.previousChapters.push(text.trim());
    }
    save(s);
  }

  function updateSummary(summaryText) {
    const s = load();
    s.previousSummary = summaryText || "";
    save(s);
  }

  function updateMeta(metaObj) {
    const s = load();
    s.meta = Object.assign({}, s.meta, metaObj || {});
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

  console.log("worldstate.gc.js laddad (GC v6.0)");
})(window);
