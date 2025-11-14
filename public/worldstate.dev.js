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
  // Skapa nytt world-state från UI-formuläret
  // (Använder dina faktiska id:n: age, hero, length, prompt)
  // -------------------------------------------------------
  function createWorldFromForm() {
    const ageSel    = document.getElementById("age");
    const heroInput = document.getElementById("hero");
    const lengthSel = document.getElementById("length");
    const promptEl  = document.querySelector("[data-id='prompt']");

    const ageValue   = ageSel && ageSel.value ? ageSel.value : "";
    const ageText    =
      ageSel &&
      ageSel.selectedOptions &&
      ageSel.selectedOptions[0]
        ? ageSel.selectedOptions[0].textContent.trim()
        : "7–8 år";

    const hero =
      heroInput && heroInput.value
        ? heroInput.value.trim()
        : "hjälten";

    const lengthVal  = lengthSel && lengthSel.value ? lengthSel.value : "";
    const lengthText =
      lengthSel &&
      lengthSel.selectedOptions &&
      lengthSel.selectedOptions[0]
        ? lengthSel.selectedOptions[0].textContent.trim()
        : "";

    const prompt =
      promptEl && promptEl.value ? promptEl.value.trim() : "";

    return {
      meta: {
        ageValue: ageValue,
        ageLabel: ageText,
        hero: hero,
        lengthValue: lengthVal,
        lengthLabel: lengthText
      },
      chapters: [],          // varje kapitel: { text, wish, added_at }
      last_prompt: prompt,   // senaste önskemålet från användaren
      created_at: Date.now()
    };
  }

  // -------------------------------------------------------
  // Se till att vi alltid har en bok: ladda eller skapa ny
  // -------------------------------------------------------
  function loadOrCreateFromForm() {
    let state = loadWS();
    if (!state) {
      state = createWorldFromForm();
      saveWS(state);
    }
    return state;
  }

  // -------------------------------------------------------
  // Lägg till kapitel i befintlig bok
  // -------------------------------------------------------
  function addChapterToWS(state, chapterText, wish) {
    if (!state) state = loadOrCreateFromForm();
    if (!chapterText) return state;

    if (!Array.isArray(state.chapters)) state.chapters = [];

    state.chapters.push({
      text: chapterText,
      wish: wish || state.last_prompt || "",
      added_at: Date.now()
    });

    return state;
  }

  // -------------------------------------------------------
  // Lägg till kapitel + spara direkt
  // -------------------------------------------------------
  function addChapterAndSave(state, chapterText, wish) {
    const updated = addChapterToWS(state, chapterText, wish);
    saveWS(updated);
    return updated;
  }

  // -------------------------------------------------------
  // Bygg WS-prompt baserat på tidigare kapitel + ny önskan
  // -------------------------------------------------------
  function buildWsPrompt(state, newWish) {
    if (!state) return "";

    const meta = state.meta || {};
    const hero = meta.hero || "hjälten";
    const ageLabel = meta.ageLabel || "7–8 år";

    if (newWish && newWish.trim()) {
      state.last_prompt = newWish.trim();
      saveWS(state);
    }

    const wishText = state.last_prompt || "";

    let recap = "Detta är första kapitlet.\n";
    if (state.chapters && state.chapters.length > 0) {
      recap = state.chapters
        .map((c, i) => {
          const base = `Kapitel ${i + 1}: ${c.text}`;
          return base;
        })
        .join("\n\n");
    }

    const nextChapter = (state.chapters ? state.chapters.length : 0) + 1;

    const wishBlock = wishText
      ? `I det här kapitlet vill barnen också att detta händer:\n"${wishText}".\nFortsätt berättelsen så att detta önskemål vävs in på ett naturligt sätt.`
      : "Fortsätt bara berättelsen naturligt utan att starta om.";

    return `
Du är en varm och trygg barnboksförfattare.
Du skriver en kapitelbok på svenska för barn i åldern ${ageLabel}.
Huvudpersonen heter ${hero} och ska ALLTID kallas "${hero}" genom hela boken.

Här är en sammanfattning av de tidigare kapitlen:
${recap}

Skriv nu KAPITEL ${nextChapter}.
- Fortsätt direkt där förra kapitlet slutade (samma värld, samma problem, samma relationer).
- Börja INTE om dagen från början (undvik "Det var en solig morgon..." osv).
- Använd samma huvudperson "${hero}" genom hela kapitlet.
- Håll språket enkelt, tydligt och tryggt för barn i åldern ${ageLabel}.
- Avsluta kapitlet med en tydlig "krok" för nästa kapitel, inte ett totalt slut.

${wishBlock}
    `.trim();
  }

  // -------------------------------------------------------
  // Nollställ bok
  // -------------------------------------------------------
  function resetWS() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      console.log("[WS DEV] reset – bok rensad");
    } catch (e) {
      console.warn("[WS DEV] kunde inte rensa bok", e);
    }
    return null;
  }

  // -------------------------------------------------------
  // Exportera globalt
  // -------------------------------------------------------
  window.WS_DEV = {
    load: loadWS,
    save: saveWS,
    createWorldFromForm,
    loadOrCreateFromForm,
    addChapterToWS,
    addChapterAndSave,
    buildWsPrompt,
    reset: resetWS
  };
})();
