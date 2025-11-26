// ======================================================================
// BN-KIDS — WORLDSTATE (GC v6.3 AUT0LOCK)
// Stabil global state-maskin för kapitelböcker + single sagor.
//
// Viktigt i v6.3:
//   - Samma API som v6.0 (load/save/reset/nextChapter/…)
//   - Samma STORAGE_KEY: "bnkids_worldstate_gc_v6"
//   - AUTOMATISK STÄDNING av gamla nycklar i localStorage:
//       bn_kids_worldstate_v4
//       bn_kids_ws_book_v1
//       bn_kids_ws_v1
//       bn_worldstate
//     → de tas bort direkt när filen laddas, så de kan aldrig mer
//       störa kapiteltråden.
//
//   - Förlorar ALDRIG kapiteltråden när prompten inte ändras.
//   - Inga regler om ton/moral här – det här är bara state.
//
// ======================================================================

(function (global) {
  "use strict";

  const STORAGE_KEY = "bnkids_worldstate_gc_v6";

  // Gamla nycklar som vi aldrig mer vill se
  const LEGACY_KEYS = [
    "bn_kids_worldstate_v4",
    "bn_kids_ws_book_v1",
    "bn_kids_ws_v1",
    "bn_worldstate"
  ];

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
  // AUT0LOCK: städa bort alla gamla worldstate-nycklar
  // Körs en gång när filen laddas.
  // -----------------------------------------------------------
  function autoLockLegacyKeys() {
    try {
      let touched = false;

      // Ta bort alla gamla nycklar om de finns
      for (const key of LEGACY_KEYS) {
        if (localStorage.getItem(key) !== null) {
          localStorage.removeItem(key);
          touched = true;
        }
      }

      if (touched) {
        console.log(
          "[WS GC v6.3] Städade bort äldre worldstate-nycklar:",
          LEGACY_KEYS.join(", ")
        );
      }
    } catch (err) {
      console.warn("[WS GC v6.3] autoLockLegacyKeys fel:", err);
    }
  }

  // Kör städningen direkt när skriptet laddas
  autoLockLegacyKeys();

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
      console.warn("[WS GC v6.3] load-fel → återställer", err);
      return defaultState();
    }
  }

  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("[WS GC v6.3] save-fel", err);
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

  console.log("worldstate.gc.js laddad (GC v6.3 autolock)");
})(window);
