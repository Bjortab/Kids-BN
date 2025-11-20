// ===============================================================
// BN-KIDS — WORLDSTATE DEV (V10.1)
// - Håller ihop ålder, längd, hjälte, prompt osv
// - Exponerar WS_DEV.loadOrCreateForm() som ws_button.dev.js kräver
// - Sparar/läser worldState i localStorage
// ===============================================================

(function (global) {
  "use strict";

  const STORAGE_KEY = "bn_kids_worldstate_dev_v2";

  // ------------------------------------------------------------
  // Default-struktur för worldState
  // ------------------------------------------------------------
  function createDefaultWorldState() {
    return {
      meta: {
        age: null,          // t.ex. "7–9", "10–12", "13–15"
        ageLabel: "",       // texten i selecten, om vi vill
        hero: "",           // hjältenamn
        length: "medium"    // "short" | "medium" | "long"
      },
      last_prompt: "",       // senaste synliga prompten i fältet
      chapters: [],          // ren text per kapitel
      story_state: {         // intern state från modellen
        currentChapter: 0,
        summary: null,
        mode: "chapter_book"
      }
    };
  }

  // ------------------------------------------------------------
  // Merge in defaultvärden utan att slänga bort befintligt
  // ------------------------------------------------------------
  function mergeWithDefaults(raw) {
    const base = createDefaultWorldState();

    if (!raw || typeof raw !== "object") return base;

    const out = Object.assign({}, base, raw);
    out.meta = Object.assign({}, base.meta, raw.meta || {});
    out.story_state = Object.assign(
      {},
      base.story_state,
      raw.story_state || {}
    );

    if (!Array.isArray(out.chapters)) out.chapters = [];

    return out;
  }

  // ------------------------------------------------------------
  // Läs localStorage
  // ------------------------------------------------------------
  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createDefaultWorldState();
      const parsed = JSON.parse(raw);
      return mergeWithDefaults(parsed);
    } catch (err) {
      console.warn("[WS DEV] Kunde inte läsa worldState från localStorage:", err);
      return createDefaultWorldState();
    }
  }

  // ------------------------------------------------------------
  // Spara till localStorage
  // ------------------------------------------------------------
  function saveToStorage(worldState) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(worldState));
    } catch (err) {
      console.warn("[WS DEV] Kunde inte spara worldState till localStorage:", err);
    }
  }

  // ------------------------------------------------------------
  // Läs formulärfält från DOM (ålder, hjälte, längd, prompt)
  // ------------------------------------------------------------
  function readFormFieldsInto(worldState) {
    const ageSelect = document.querySelector("#age");
    const heroInput = document.querySelector("#hero");
    const lengthSelect = document.querySelector("#length");
    const promptTextarea = document.querySelector("#prompt");

    if (ageSelect) {
      const sel = ageSelect;
      const rawValue = sel.value || "";
      worldState.meta.age = rawValue || null;

      const label =
        sel.options && sel.selectedIndex >= 0
          ? sel.options[sel.selectedIndex].text
          : "";
      worldState.meta.ageLabel = label || rawValue || "";
    }

    if (heroInput) {
      worldState.meta.hero = heroInput.value || "";
    }

    if (lengthSelect) {
      worldState.meta.length = lengthSelect.value || "medium";
    }

    if (promptTextarea) {
      worldState.last_prompt = promptTextarea.value || "";
    }

    return worldState;
  }

  // ------------------------------------------------------------
  // Skriv tillbaka worldState → formulär (används ev. vid load)
  // ------------------------------------------------------------
  function writeWorldStateToForm(worldState) {
    const ageSelect = document.querySelector("#age");
    const heroInput = document.querySelector("#hero");
    const lengthSelect = document.querySelector("#length");
    const promptTextarea = document.querySelector("#prompt");

    if (ageSelect && worldState.meta.age != null) {
      ageSelect.value = String(worldState.meta.age);
    }

    if (heroInput) {
      heroInput.value = worldState.meta.hero || "";
    }

    if (lengthSelect) {
      lengthSelect.value = worldState.meta.length || "medium";
    }

    if (promptTextarea) {
      promptTextarea.value = worldState.last_prompt || "";
    }
  }

  // ------------------------------------------------------------
  // Publik API för ws_button.dev.js
  // ------------------------------------------------------------

  /**
   * loadOrCreateForm()
   * - läser worldState från storage
   * - uppdaterar den med aktuella formulärfält
   * - skriver tillbaka till storage
   * - returnerar worldState-objektet
   */
  function loadOrCreateForm() {
    let ws = loadFromStorage();
    ws = mergeWithDefaults(ws);

    // uppdatera med vad som står i formuläret just nu
    ws = readFormFieldsInto(ws);

    // bumpa kapitelräknare om chapters-listan är längre
    if (!ws.story_state) ws.story_state = {};
    if (typeof ws.story_state.currentChapter !== "number") {
      ws.story_state.currentChapter = ws.chapters.length;
    }

    saveToStorage(ws);
    console.log("[WS DEV] loadOrCreateForm →", ws);
    return ws;
  }

  /**
   * saveWorldState(worldState)
   * - uppdaterar storage + (valfritt) formulär
   */
  function saveWorldState(worldState) {
    if (!worldState) return;
    const ws = mergeWithDefaults(worldState);
    saveToStorage(ws);
    writeWorldStateToForm(ws);
    console.log("[WS DEV] saveWorldState →", ws);
    return ws;
  }

  /**
   * resetWorldState()
   * - används vid "Rensa" om vi vill börja om helt
   */
  function resetWorldState() {
    const ws = createDefaultWorldState();
    saveToStorage(ws);
    writeWorldStateToForm(ws);
    console.log("[WS DEV] resetWorldState →", ws);
    return ws;
  }

  // ------------------------------------------------------------
  // Exponera globalt så ws_button.dev.js hittar det
  // ------------------------------------------------------------
  const WS_DEV = (global.WS_DEV = global.WS_DEV || {});
  WS_DEV.loadOrCreateForm = loadOrCreateForm;
  WS_DEV.saveWorldState = saveWorldState;
  WS_DEV.resetWorldState = resetWorldState;

  console.log("[WS DEV] worldstate.dev.js laddad (V10.1)");
})(window);
