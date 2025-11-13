// ==========================================================
// BN-KIDS WS DEV — worldstate.dev.js (v1)
// Lokal "bok" i localStorage, kapitel för kapitel
// ==========================================================

(function () {

  const STORAGE_KEY = "bn_kids_ws_book_v1";

  // -------------------------------------------------------
  // Ladda world state (bok) från localStorage
  // -------------------------------------------------------
  function loadWS() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (e) {
      console.warn("[WS] kunde inte läsa world state", e);
    }
    return null;
  }

  // -------------------------------------------------------
  // Spara world state
  // -------------------------------------------------------
  function saveWS(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("[WS] kunde inte spara world state", e);
    }
  }

  // -------------------------------------------------------
  // Skapa nytt world-state från UI-formuläret
  // -------------------------------------------------------
  function createWorldFromForm() {
    const age = (document.querySelector("[data-id='age']")?.value || "").trim();
    const hero = (document.querySelector("[data-id='hero']")?.value || "").trim();
    const length = (document.querySelector("[data-id='length']")?.value || "").trim();
    const prompt = (document.querySelector("[data-id='prompt']")?.value || "").trim();

    return {
      meta: {
        age,
        hero,
        length,
      },
      chapters: [],
      last_prompt: prompt || "",
      created_at: Date.now(),
    };
  }

  // -------------------------------------------------------
  // Uppdatera world state med nytt kapitel
  // -------------------------------------------------------
  function addChapterToWS(state, chapterText) {
    if (!state || !chapterText) return state;
    state.chapters.push({
      text: chapterText,
      added_at: Date.now(),
    });
    return state;
  }

  // -------------------------------------------------------
  // Bygg WS-prompt baserat på tidigare kapitel
  // -------------------------------------------------------
  function buildWsPrompt(state) {
    if (!state) return "";

    const hero = state.meta.hero || "barnet";
    const recap = state.chapters
      .map((c, i) => `Kapitel ${i + 1}: ${c.text}`)
      .join("\n\n");

    return `
Du är en barnboksförfattare.
Du skriver kapitelböcker för barn i åldern ${state.meta.age}.
Hjälten heter: ${hero}.

Här är recap på tidigare kapitel:
${recap}

Skriv nästa kapitel som följer handlingen exakt, utan att repetera tidigare innehåll.
Sluta kapitel ${state.chapters.length + 1} med en tydlig cliffhanger. 
    `;
  }

  // -------------------------------------------------------
  // Nollställ bok (debug)
  // -------------------------------------------------------
  function resetWS() {
    localStorage.removeItem(STORAGE_KEY);
  }

  // -------------------------------------------------------
  // Exportera globalt
  // -------------------------------------------------------
  window.WS_DEV = {
    load: loadWS,
    save: saveWS,
    createWorldFromForm,
    addChapterToWS,
    buildWsPrompt,
    reset: resetWS,
  };

})();
