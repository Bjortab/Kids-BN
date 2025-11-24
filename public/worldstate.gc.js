/* ============================================================
   BN-KIDS — WORLDSTATE (GC v3.4)
   Stabil version som BN använder i produktion.
   - Håller rätt på bokdata, kapitelIndex, hjälte, prompt osv.
   - Inga experimentella funktioner.
   ============================================================ */

(function (global) {
  "use strict";

  const WS_VERSION = "bn-ws-gc-v3.4";

  // ------------------------------------------------------------
  // Default worldState som används vid första sagan
  // ------------------------------------------------------------
  const defaultWorldState = {
    meta: {
      hero: "",
      age: "",
      mode: "single_story",
      length: "medium",
      tone: "mixed",
      originalPrompt: "",
      userId: null
    },
    story_mode: "single_story",
    chapterIndex: 1,
    previousChapters: [],
    previousSummary: "",
    _userPrompt: "",
    last_prompt: ""
  };

  // ------------------------------------------------------------
  // Ladda worldState från localStorage
  // ------------------------------------------------------------
  function load() {
    try {
      const raw = localStorage.getItem("bn_worldstate");
      if (!raw) return structuredClone(defaultWorldState);

      const parsed = JSON.parse(raw);

      // Safety: om något saknas → fyll på
      return Object.assign(structuredClone(defaultWorldState), parsed);
    } catch (_) {
      return structuredClone(defaultWorldState);
    }
  }

  // ------------------------------------------------------------
  // Spara worldState
  // ------------------------------------------------------------
  function save(state) {
    if (!state) return;
    try {
      localStorage.setItem("bn_worldstate", JSON.stringify(state));
    } catch (_) {
      /* ignore */
    }
  }

  // ------------------------------------------------------------
  // RESET — rensa allt inför ny saga
  // ------------------------------------------------------------
  function reset() {
    const ws = structuredClone(defaultWorldState);
    save(ws);
    return ws;
  }

  // ------------------------------------------------------------
  // Uppdatera meta-info (age, hero, mode, length, tone)
  // ------------------------------------------------------------
  function updateMeta(patch) {
    const ws = load();
    ws.meta = Object.assign({}, ws.meta, patch || {});
    save(ws);
    return ws;
  }

  // ------------------------------------------------------------
  // Uppdatera aktuell prompt (den som motorn ska använda)
  // ------------------------------------------------------------
  function updatePrompt(promptText) {
    const ws = load();
    ws._userPrompt = promptText || "";
    ws.last_prompt = promptText || "";
    save(ws);
    return ws;
  }

  // ------------------------------------------------------------
  // Öka kapitelIndex
  // ------------------------------------------------------------
  function nextChapter() {
    const ws = load();
    ws.chapterIndex = Number(ws.chapterIndex || 1) + 1;
    save(ws);
    return ws;
  }

  // ------------------------------------------------------------
  // Lägg till kapitel i historiken
  // ------------------------------------------------------------
  function addChapterToHistory(text) {
    const ws = load();
    if (!ws.previousChapters) ws.previousChapters = [];
    ws.previousChapters.push(text || "");
    save(ws);
    return ws;
  }

  // ------------------------------------------------------------
  // Sammanfatta tidigare kapitel
  // (Detta används av story_engine.gc.js)
  // ------------------------------------------------------------
  function updateSummary(shortText) {
    const ws = load();
    ws.previousSummary = shortText || "";
    save(ws);
    return ws;
  }

  // ------------------------------------------------------------
  // EXPORTERA
  // ------------------------------------------------------------
  global.BNWorldState = {
    load,
    save,
    reset,
    updateMeta,
    updatePrompt,
    nextChapter,
    addChapterToHistory,
    updateSummary,
    WS_VERSION
  };
})(window);
