// ==========================================================
// BN-KIDS WS DEV — worldstate.dev.js (v5b)
// Kapitelbok i localStorage + bättre kapitel-logik
// - Varje klick på WS-knappen = nytt kapitel i samma bok
// - Kapitlen ska ha tydlig början och tydligt avslut
// - Stöd för "sista kapitlet" (manuellt + auto efter flera kapitel)
// - Inkluderar helper: loadOrCreateFromForm (används av ws_button.dev.js)
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
    const hero       = heroInput && heroInput.value ? heroInput.value.trim() : "";
    const lengthVal  = lengthSel && lengthSel.value ? lengthSel.value : "";
    const lengthText = (lengthSel && lengthSel.selectedOptions && lengthSel.selectedOptions[0])
      ? lengthSel.selectedOptions[0].textContent.trim()
      : "";
    const prompt     = promptEl && promptEl.value ? promptEl.value.trim() : "";

    return {
      meta: {
        ageValue: ageValue,
        ageLabel: ageText || "7–8 år",
        hero: hero || "hjälten",
        lengthValue: lengthVal,
        lengthLabel: lengthText || "Mellan (≈5 min)"
      },
      chapters: [],          // varje kapitel: { text, added_at }
      last_prompt: prompt,   // ursprunglig barnprompt
      created_at: Date.now()
    };
  }

  // -------------------------------------------------------
  // Helper: ladda befintlig bok eller skapa ny från formuläret
  // (DETTA är funktionen ws_button.dev.js ropar på)
// -------------------------------------------------------
  function loadOrCreateFromForm() {
    let state = loadWS();
    if (!state) {
      state = createWorldFromForm();
      saveWS(state);
      console.log("[WS DEV] skapade ny bok från formulär");
    } else {
      console.log("[WS DEV] laddade befintlig bok", state);
    }
    return state;
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
  //  - Ser till att varje kapitel får tydlig början och slut
  //  - Tar ev. "önskemål" med som extra instruktion
  //  - Kan markera att detta är "sista kapitlet"
  // -------------------------------------------------------
  function buildWsPrompt(state, wishOrOpts) {
    if (!state) return "";

    // Litet försvar mot olika sätt att skicka in önskemål
    let wishText = "";
    if (typeof wishOrOpts === "string") {
      wishText = wishOrOpts.trim();
    } else if (wishOrOpts && typeof wishOrOpts.wish === "string") {
      wishText = wishOrOpts.wish.trim();
    }

    const hero     = (state.meta && state.meta.hero) || "hjälten";
    const ageLabel = (state.meta && state.meta.ageLabel) || "7–8 år";

    const chapters = Array.isArray(state.chapters) ? state.chapters : [];
    const nextChapter = chapters.length + 1;

    // Enkel recap: vi skickar in texten som är,
    // men prefixar med "Kapitel X:" så modellen förstår strukturen.
    let recap = "Detta är första kapitlet.\n";
    if (chapters.length > 0) {
      recap = chapters
        .map((c, i) => `Kapitel ${i + 1} (kort sammanfattning av tidigare text):\n${c.text}`)
        .join("\n\n");
    }

    const lengthHint = (state.meta && state.meta.lengthLabel) || "Mellan (≈5 min)";

    // --- Logik för sista kapitlet -------------------------
    const wishLower = wishText.toLowerCase();
    const mentionsLast =
      wishLower.includes("sista kapitlet") ||
      wishLower.includes("avsluta berättelsen") ||
      wishLower.includes("avsluta boken") ||
      wishLower.includes("slutet på berättelsen") ||
      wishLower.includes("slutet på boken");

    // Auto: om vi redan har många kapitel, föreslå naturligt slut
    const AUTO_LAST_AFTER_CHAPTERS = 5; // kan justeras senare
    const autoLast = chapters.length >= AUTO_LAST_AFTER_CHAPTERS;

    const isLastChapter = mentionsLast || autoLast;

    // ------------------------------------------------------
    // Själva systemprompten till modellen
    // ------------------------------------------------------
    const prompt = `
Du är en varm och trygg barnboksförfattare.
Du skriver en kapitelbok på svenska för barn i åldern ${ageLabel}.
Huvudpersonen heter ${hero} och ska alltid kallas "${hero}" genom hela boken.

Barnets ursprungliga idé (från starten av boken) är:
"${state.last_prompt || ""}"

Här är en översikt över vad som hänt i tidigare kapitel:
${recap}

Du ska nu skriva KAPITEL ${nextChapter}.

Struktur för kapitlet:
- Börja kapitlet med 1–3 meningar som knyter an till slutet av föregående kapitel
  (t.ex. hur det kändes, vart de var på väg, vad de nu vill göra),
  men upprepa inte hela föregående scen.
- Efter den korta återkopplingen ska du föra berättelsen vidare
  till en NY scen, ny händelse eller ny utveckling.
- Skriv kapitlet så att det fungerar fristående: det ska ha en tydlig början,
  en mitt och ett slut.

Tydligt slut för kapitlet:
- Avsluta alltid kapitlet med en fullständig mening som slutar med punkt.
- Avsluta inte mitt i en mening.

Om detta är sista kapitlet i boken:
- Knyt ihop de viktigaste trådarna i berättelsen.
- Ge ett lugnt, fint och hoppfullt slut.
- Lämna inte kvar stora obesvarade frågor.
- Efter detta kapitel ska det kännas som att boken är färdig.
${isLastChapter
  ? "Behandla detta kapitel som SISTA kapitlet i boken."
  : "Lämna gärna en mjuk krok mot framtida äventyr, men gör ändå kapitlet komplett i sig själv."
}

Tonalitet:
- Språket ska vara enkelt, tydligt och tryggt för barn i åldern ${ageLabel}.
- Håll en positiv och hoppfull ton, även när det är lite spännande.
- Undvik brutalt våld, död eller skrämmande detaljer.

Längd:
- Skriv ett kapitel som ungefär motsvarar ${lengthHint} högläsningstid.
- Det är viktigare att kapitlet känns komplett än att det är exakt en viss längd.

Önskemål från barnet (om något av detta finns, väv in det naturligt i kapitlet):
${wishText ? `- "${wishText}"` : "- (inga extra önskemål just nu)"}
    `.trim();

    return prompt;
  }

  // -------------------------------------------------------
  // Nollställ bok (debug / rensa-knapp)
  // -------------------------------------------------------
  function resetWS() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn("[WS] kunde inte rensa world state", e);
    }
  }

  // -------------------------------------------------------
  // Exportera globalt
  // -------------------------------------------------------
  window.WS_DEV = {
    load: loadWS,
    save: saveWS,
    createWorldFromForm: createWorldFromForm,
    loadOrCreateFromForm: loadOrCreateFromForm, // <- viktig för ws_button.dev.js
    addChapterToWS: addChapterToWS,
    buildWsPrompt: buildWsPrompt,
    reset: resetWS
  };
})();
