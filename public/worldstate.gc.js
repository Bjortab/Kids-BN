// public/worldstate.gc.js
// BNWorldState v3.1 (GC)
// ----------------------------------------------
// Håller reda på barnets bok mellan kapitel:
// - meta (hjälte, ålder, längd, totalChapters m.m.)
// - previousChapters (lista med alla kapiteltexter)
// - previousSummary (kort recap till backend)
// - last_prompt / _userPrompt
// - story_mode ("chapter_book" / "single_story")
// - chapterIndex (1-baserad)
//
// Används av ws_button.gc.js och story_engine.gc.js
// ----------------------------------------------

(function (global) {
  "use strict";

  const STORAGE_KEY = "bn_kids_worldstate_v3_1";

  const log = (...args) => console.log("[BNWorldState]", ...args);

  // -----------------------------
  // Bas-state
  // -----------------------------
  function createDefaultState() {
    return {
      meta: {
        hero: "",
        age: "",
        ageValue: "",
        ageLabel: "",
        length: "",
        lengthValue: "",
        lengthLabel: "",
        totalChapters: 8 // standard – kan justeras
      },
      story_mode: "chapter_book", // standardläge i BN-Kids
      chapterIndex: 0,
      previousChapters: [],
      previousSummary: "",
      last_prompt: "",
      _userPrompt: "",
      createdAt: Date.now()
    };
  }

  // -----------------------------
  // Storage helpers
  // -----------------------------
  function safeParse(json) {
    try {
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  function loadFromStorage() {
    if (typeof localStorage === "undefined") {
      return createDefaultState();
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();

    const parsed = safeParse(raw);
    if (!parsed || typeof parsed !== "object") {
      return createDefaultState();
    }

    // Se till att alla fält finns
    const base = createDefaultState();
    return {
      ...base,
      ...parsed,
      meta: {
        ...base.meta,
        ...(parsed.meta || {})
      },
      previousChapters: Array.isArray(parsed.previousChapters)
        ? parsed.previousChapters
        : [],
      chapterIndex: Number(parsed.chapterIndex || 0)
    };
  }

  function saveToStorage(state) {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("[BNWorldState] kunde inte spara i localStorage", e);
    }
  }

  // Håll ett in-memory-cache så vi slipper parsning hela tiden
  let _state = loadFromStorage();

  function getState() {
    if (!_state) _state = loadFromStorage();
    return _state;
  }

  function setState(next) {
    _state = next;
    saveToStorage(next);
    return next;
  }

  // -----------------------------
  // Publikt API
  // -----------------------------

  // Ladda nuvarande worldstate (utan att göra reset)
  function load() {
    return getState();
  }

  // Reset – rensa allt och starta ny bok
  function reset() {
    const fresh = createDefaultState();
    log("reset → ny worldstate");
    return setState(fresh);
  }

  // Uppdatera meta-info
  function updateMeta(patch) {
    const s = getState();
    s.meta = {
      ...s.meta,
      ...(patch || {})
    };
    return setState(s);
  }

  // Sätt användarens prompt
  function updatePrompt(prompt) {
    const s = getState();
    const p = (prompt || "").trim();
    s._userPrompt = p;
    s.last_prompt = p;
    return setState(s);
  }

  // Sätt total antal kapitel (t.ex. 8–12)
  function setTotalChapters(n) {
    const total = Number(n || 0);
    if (!total || total < 1) return getState();
    const s = getState();
    s.meta.totalChapters = total;
    return setState(s);
  }

  // Nästa kapitel (ökar chapterIndex)
  function nextChapter() {
    const s = getState();
    if (!s.chapterIndex || s.chapterIndex < 1) {
      s.chapterIndex = 1;
    } else {
      s.chapterIndex += 1;
    }
    return setState(s);
  }

  // Spara ett helt kapitel i historiken
  function addChapterToHistory(chapterText) {
    const s = getState();
    const text = String(chapterText || "").trim();
    if (!text) return s;

    if (!Array.isArray(s.previousChapters)) {
      s.previousChapters = [];
    }
    s.previousChapters.push(text);

    // Hårdkapa historiken vid ~20 kapitel för säkerhets skull
    if (s.previousChapters.length > 20) {
      s.previousChapters = s.previousChapters.slice(
        s.previousChapters.length - 20
      );
    }

    return setState(s);
  }

  // Uppdatera sammanfattning (recap)
  function updateSummary(summaryText) {
    const s = getState();
    s.previousSummary = String(summaryText || "").trim();
    return setState(s);
  }

  // Debug-hjälpare i konsolen
  function debugGet() {
    return getState();
  }

  function debugClearStorageOnly() {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(STORAGE_KEY);
    _state = createDefaultState();
    log("localStorage-cleared, state reset in-memory.");
  }

  // Exponera globalt
  global.BNWorldState = {
    load,
    reset,
    updateMeta,
    updatePrompt,
    nextChapter,
    addChapterToHistory,
    updateSummary,
    setTotalChapters,
    // debug:
    _debugGet: debugGet,
    _debugClearStorage: debugClearStorageOnly
  };

  log("BNWorldState v3.1 laddad");
})(window);
