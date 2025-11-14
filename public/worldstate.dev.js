// ==========================================================
// BN-KIDS WS DEV — worldstate.dev.js (v3)
// Lokal "bok" i localStorage, kapitel för kapitel
// ==========================================================

(function () {
  "use strict";

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
  // (använder dina id:n: age, hero, length, prompt)
  // -------------------------------------------------------
  function createWorldFromForm() {
    const ageSel    = document.getElementById("age");
    const heroInput = document.getElementById("hero");
    const lengthSel = document.getElementById("length");
    const promptEl  = document.querySelector("[data-id='prompt']");

    const ageValue   = (ageSel && ageSel.value) || "";
    const ageText    =
      ageSel &&
      ageSel.selectedOptions &&
      ageSel.selectedOptions[0]
        ? ageSel.selectedOptions[0].textContent.trim()
        : "";
    const hero       =
      heroInput && heroInput.value ? heroInput.value.trim() : "";
    const lengthVal  = (lengthSel && lengthSel.value) || "";
    const lengthText =
      lengthSel &&
      lengthSel.selectedOptions &&
      lengthSel.selectedOptions[0]
        ? lengthSel.selectedOptions[0].textContent.trim()
        : "";
    const prompt     =
      promptEl && promptEl.value ? promptEl.value.trim() : "";

    return {
      meta: {
        ageValue:   ageValue,
        ageLabel:   ageText,
        hero:       hero,
        lengthValue: lengthVal,
        lengthLabel: lengthText
      },
      chapters: [],          // varje kapitel: { text, added_at }
      last_prompt: prompt,   // ursprunglig barnprompt / önskemål
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
  // Bygg WS-prompt baserat på tidigare kapitel + barnets önskemål
  //  - använder sista kapitlets slut som “ankare”
  // -------------------------------------------------------
  function buildWsPrompt(state, wishText) {
    if (!state) return "";

    const hero =
      (state.meta && state.meta.hero && state.meta.hero.trim()) ||
      "hjälten";
    const ageLabel =
      (state.meta && state.meta.ageLabel && state.meta.ageLabel.trim()) ||
      "7–8 år";

    let recap = "";
    const chapters = Array.isArray(state.chapters)
      ? state.chapters
      : [];

    if (!chapters.length) {
      // Första kapitlet – använd barnets ursprungliga idé
      const base = (state.last_prompt || "").trim();
      recap = base
        ? `Barnets önskan för berättelsen är:\n"${base}".`
        : "Detta är början på en ny berättelse.";
    } else {
      // Senaste kapitlets slut – ta de sista ~3 meningarna
      const last = String(chapters[chapters.length - 1].text || "")
        .trim()
        .replace(/\s+/g, " ");

      const parts = last.split(/(?<=[.!?])\s+/);
      const tail = parts.slice(-3).join(" ");
      recap = `Senaste kapitlet slutade ungefär så här:\n"${tail}"`;
    }

    const nextChapter = chapters.length + 1;

    let wishBlock = "";
    const wish = (wishText || "").trim();
    if (wish) {
      wishBlock = `
Barnet har önskat följande till berättelsen:
"${wish}".
Väv in detta naturligt i kapitlet utan att starta om historien.`;
    }

    const prompt = [
      `Du är en erfaren barnboksförfattare på svenska för barn i åldern ${ageLabel}.`,
      `Du skriver en kapitelbok där huvudpersonen heter ${hero} och alltid ska kallas "${hero}" i texten.`,
      ``,
      `Berättelsen hittills:`,
      recap,
      ``,
      `Nu ska du skriva KAPITEL ${nextChapter}.`,
      `Fortsätt exakt där förra kapitlet slutade i tid och plats.`,
      `Starta INTE om historien från början. Upprepa inte samma “solig morgon”, “skogen” eller “skatt” igen om det redan hänt.`,
      `Håll dig till samma värld, samma figurer och samma ton.`,
      `Skriv i ett lugnt, tydligt och tryggt språk som passar ett barn i åldern ${ageLabel}.`,
      `Avsluta kapitlet med en tydlig scen som leder vidare mot nästa kapitel, gärna med en liten cliffhanger men inget brutalt slut.`,
      wishBlock
    ].join("\n");

    return prompt.trim();
  }

  // -------------------------------------------------------
  // Nollställ bok (debug)
  // -------------------------------------------------------
  function resetWS() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      console.log("[WS DEV] world state reset (localStorage cleared)");
    } catch (e) {
      console.warn("[WS] kunde inte nollställa world state", e);
    }
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
    reset: resetWS
  };

})();
