// ==========================================================
// BN-KIDS WS DEV — worldstate.dev.js (v2.1)
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
  // (Använder dina faktiska id:n: age, hero, length, prompt)
  // -------------------------------------------------------
  function createWorldFromForm() {
    const ageSel    = document.getElementById("age");
    const heroInput = document.getElementById("hero");
    const lengthSel = document.getElementById("length");
    const promptEl  = document.querySelector("[data-id='prompt']");

    const ageValue   = ageSel && ageSel.value ? ageSel.value : "";
    const ageText    = (ageSel && ageSel.selectedOptions && ageSel.selectedOptions[0])
      ? ageSel.selectedOptions[0].textContent.trim()
      : "";

    // Robust hjälte-hantering – så vi ALDRIG kraschar på hero
    let hero = "";
    if (heroInput && typeof heroInput.value === "string") {
      hero = heroInput.value.trim();
    }
    if (!hero) hero = "hjälten";

    const lengthVal  = lengthSel && lengthSel.value ? lengthSel.value : "";
    const lengthText = (lengthSel && lengthSel.selectedOptions && lengthSel.selectedOptions[0])
      ? lengthSel.selectedOptions[0].textContent.trim()
      : "";
    const prompt     = promptEl && promptEl.value ? promptEl.value.trim() : "";

    return {
      meta: {
        ageValue:   ageValue,
        ageLabel:   ageText,
        hero:       hero,
        lengthValue: lengthVal,
        lengthLabel: lengthText
      },
      chapters: [],          // varje kapitel: { text, added_at }
      last_prompt: prompt,   // ursprunglig barnprompt
      created_at: Date.now()
    };
  }

  // -------------------------------------------------------
  // Uppdatera world state med nytt kapitel
  // -------------------------------------------------------
  function addChapterToWS(state, chapterText) {
    if (!state || !chapterText) return state || null;
    if (!Array.isArray(state.chapters)) state.chapters = [];
    state.chapters.push({
      text: chapterText,
      added_at: Date.now()
    });
    return state;
  }

  // -------------------------------------------------------
  // Bygg WS-prompt baserat på tidigare kapitel
  // (enkel recap-version – vi kan göra den smartare sen)
  // -------------------------------------------------------
  function buildWsPrompt(state) {
    if (!state) return "";

    const hero = (state.meta && state.meta.hero) || "hjälten";
    const ageLabel = (state.meta && state.meta.ageLabel) || "7–8 år";

    let recap = "Detta är första kapitlet.\n";
    if (state.chapters && state.chapters.length > 0) {
      recap = state.chapters
        .map((c, i) => `Kapitel ${i + 1}: ${c.text}`)
        .join("\n\n");
    }

    const nextChapter = (state.chapters ? state.chapters.length : 0) + 1;

    return `
Du är en barnboksförfattare.
Du skriver en kapitelbok på svenska för barn i åldern ${ageLabel}.
Huvudpersonen heter ${hero} och ska alltid kallas "${hero}" genom hela boken.

Här är en sammanfattning av de tidigare kapitlen:
${recap}

Skriv nu KAPITEL ${nextChapter}.
- Fortsätt berättelsen logiskt från tidigare händelser.
- Upprepa inte exakt samma början eller samma scener som redan hänt.
- Använd samma huvudperson "${hero}" och samma värld.
- Håll språket enkelt, tydligt och tryggt för barn i åldern ${ageLabel}.
- Avsluta kapitlet med ett tydligt men gärna lite spännande slut (en krok för nästa kapitel, ingen total reset).
    `.trim();
  }

  // -------------------------------------------------------
  // Nollställ bok (debug)
  // -------------------------------------------------------
  function resetWS() {
    localStorage.removeItem(STORAGE_KEY);
  }

  // -------------------------------------------------------
  // Exportera globalt (dev namespace)
  // -------------------------------------------------------
  window.WS_DEV = {
    load: loadWS,
    save: saveWS,
    createWorldFromForm,
    addChapterToWS,
    buildWsPrompt,
    reset: resetWS
  };
})();
