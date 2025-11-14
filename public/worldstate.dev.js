// ==========================================================
// BN-KIDS WS DEV — worldstate.dev.js (v3)
// Kapitelbok i localStorage + önskemål per kapitel
// ==========================================================

(function () {
  "use strict";

  const STORAGE_KEY = "bn_kids_ws_book_v3";

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
      console.warn("[WS DEV] kunde inte läsa world state", e);
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
      console.warn("[WS DEV] kunde inte spara world state", e);
    }
  }

  // -------------------------------------------------------
  // Skapa nytt world state från UI-formuläret
  // -------------------------------------------------------
  function createWorldFromForm() {
    const ageSel    = document.getElementById("age");
    const heroInput = document.getElementById("hero");
    const lengthSel = document.getElementById("length");
    const promptEl  = document.querySelector("[data-id='prompt']");

    const ageValue = ageSel && ageSel.value ? ageSel.value : "";
    const ageText =
      ageSel &&
      ageSel.selectedOptions &&
      ageSel.selectedOptions[0] &&
      ageSel.selectedOptions[0].textContent
        ? ageSel.selectedOptions[0].textContent.trim()
        : "";

    const hero =
      heroInput && heroInput.value ? heroInput.value.trim() : "";

    const lengthVal = lengthSel && lengthSel.value ? lengthSel.value : "";
    const lengthText =
      lengthSel &&
      lengthSel.selectedOptions &&
      lengthSel.selectedOptions[0] &&
      lengthSel.selectedOptions[0].textContent
        ? lengthSel.selectedOptions[0].textContent.trim()
        : "";

    const basePrompt =
      promptEl && promptEl.value ? promptEl.value.trim() : "";

    return {
      meta: {
        ageValue,
        ageLabel: ageText || "7–8 år",
        hero: hero || "hjälten",
        lengthValue: lengthVal,
        lengthLabel: lengthText || "Mellan (≈5 min)"
      },
      chapters: [],               // varje kapitel: { text, added_at }
      basePrompt,                 // ursprunglig idé från barnet
      lastWish: "",               // senaste önskemål för nästa kapitel
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
  // Bygg WS-prompt baserat på tidigare kapitel + ev önskemål
  // options: { wish?: string }
  // -------------------------------------------------------
  function buildWsPrompt(state, options) {
    if (!state) return "";

    const hero = (state.meta && state.meta.hero) || "hjälten";
    const ageLabel = (state.meta && state.meta.ageLabel) || "7–8 år";

    const chapters = Array.isArray(state.chapters)
      ? state.chapters
      : [];

    let recap;
    if (chapters.length === 0) {
      // Första kapitlet – använd basprompten
      recap = state.basePrompt
        ? `Barnets idé till berättelsen är: "${state.basePrompt}".`
        : "Barnet vill ha ett nytt äventyr.";
    } else {
      // Gör en ganska kort recap av tidigare kapitel
      recap = chapters
        .map((c, i) => {
          // Ta bara första ~300 tecknen per kapitel för att inte svälla
          const t = (c.text || "").trim().replace(/\s+/g, " ");
          const short = t.slice(0, 300);
          return `Kapitel ${i + 1}: ${short}${t.length > 300 ? " …" : ""}`;
        })
        .join("\n\n");
    }

    const nextChapter = chapters.length + 1;

    const wish = options && options.wish
      ? options.wish.trim()
      : "";

    let wishText = "";
    if (wish) {
      wishText = `
Barnets önskemål för nästa kapitel:
"${wish}".
`.trim();
    }

    // Själva prompten till modellen
    const prompt = `
Du är en trygg, varm och tydlig barnboksförfattare.
Du skriver en kapitelbok på svenska för barn i åldern ${ageLabel}.
Huvudpersonen heter ${hero} och ska ALLTID kallas exakt "${hero}" genom hela boken.

Bakgrund och tidigare kapitel:
${recap}

${wishText ? wishText + "\n\n" : ""}Skriv nu KAPITEL ${nextChapter}.

Regler:
- Fortsätt berättelsen logiskt från tidigare händelser.
- Upprepa INTE exakt samma början, miljö eller händelser som tidigare kapitel.
- Använd samma huvudperson "${hero}" och samma värld.
- Håll språket enkelt, tydligt och tryggt för barn i åldern ${ageLabel}.
- Undvik våld, blod, död och läskiga detaljer.
- Avsluta kapitlet med en tydlig krok eller förväntan inför nästa kapitel,
  inte med ett "allt är klart och över"-slut.
`.trim();

    return prompt;
  }

  // -------------------------------------------------------
  // Nollställ bok (debug i console)
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
    reset: resetWS
  };
})();
