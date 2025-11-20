// ==========================================================
// BN-KIDS WS DEV — worldstate.dev.js (v6 GC)
// Kapitelbok i localStorage + bättre kapitel-logik
// - Varje klick på WS-knappen = nytt kapitel i samma bok
// - Kortare recap så kapitlet hinner avslutas
// - Tydligare styrning för "sista kapitlet"
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
    const ageText    =
      ageSel && ageSel.selectedOptions && ageSel.selectedOptions[0]
        ? ageSel.selectedOptions[0].textContent.trim()
        : "";
    const hero       = heroInput && heroInput.value ? heroInput.value.trim() : "";
    const lengthVal  = lengthSel && lengthSel.value ? lengthSel.value : "";
    const lengthText =
      lengthSel && lengthSel.selectedOptions && lengthSel.selectedOptions[0]
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
      last_prompt: prompt,   // ursprunglig/senaste barnprompt
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
  // Hjälpare för kortare recap så kapitlet hinner bli klart
  // -------------------------------------------------------
  function snippetStart(txt, maxLen) {
    if (!txt) return "";
    const clean = txt.replace(/\s+/g, " ").trim();
    if (clean.length <= maxLen) return clean;
    return clean.slice(0, maxLen) + " …";
  }

  function snippetEnd(txt, maxLen) {
    if (!txt) return "";
    const clean = txt.replace(/\s+/g, " ").trim();
    if (clean.length <= maxLen) return clean;
    return "… " + clean.slice(clean.length - maxLen);
  }

  // -------------------------------------------------------
  // Bygg WS-prompt baserat på tidigare kapitel
  //  - Kort recap (början + slut) istället för full text
  //  - Tydligare instruktion om längd + avslut
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

    const chapters    = Array.isArray(state.chapters) ? state.chapters : [];
    const nextChapter = chapters.length + 1;

    // ---- Ny, kort recap: början + slut på senaste kapitel ----
    let recap;
    if (chapters.length === 0) {
      recap =
        "Detta är början av berättelsen. Inga tidigare kapitel finns ännu.\n";
    } else {
      const first = chapters[0].text || "";
      const last  = chapters[chapters.length - 1].text || "";

      const firstShort = snippetStart(first, 220);
      const lastShort  = snippetEnd(last, 260);

      recap =
        "Så här började berättelsen (kort sammanfattning):\n" +
        firstShort +
        "\n\n" +
        "Så här slutade det senaste kapitlet (fortsätt härifrån, inte från början):\n" +
        lastShort +
        "\n";
    }

    // Extra instruktion om detta kapitlet ska kännas som "sista"
    const wishLower = wishText.toLowerCase();
    const isMaybeLast =
      wishLower.includes("sista kapitlet") ||
      wishLower.includes("avsluta berättelsen") ||
      wishLower.includes("avsluta boken") ||
      wishLower.includes("slutet på berättelsen") ||
      wishLower.includes("slutet på boken");

    const lengthHint =
      (state.meta && state.meta.lengthLabel) || "Mellan (≈5 min)";

    const baseLengthInstr =
      "Skriv ett kapitel på ungefär 8–14 meningar. " +
      "Det är viktigare att kapitlet känns komplett än att det är långt. " +
      "Om du märker att du börjar närma dig slutet av din text, " +
      "avrunda kapitlet med en fullständig mening istället för att fortsätta.";

    const endingInstr = isMaybeLast
      ? "Detta ska vara SISTA kapitlet i boken. Knyt ihop de viktigaste trådarna, " +
        "ge ett lugnt och hoppfullt slut och lämna inte kvar stora obesvarade frågor. " +
        "Starta inte ett helt nytt äventyr i slutet."
      : "Detta är ett MITTENKAPITEL. Avsluta kapitlet med en hel mening och en mjuk krok " +
        "som gör att man vill läsa nästa kapitel, men börja inte om berättelsen från början.";

    // Själva systemprompten till modellen
    const prompt = `
Du är en varm och trygg barnboksförfattare.
Du skriver en kapitelbok på svenska för barn i åldern ${ageLabel}.
Huvudpersonen heter ${hero} och ska alltid kallas "${hero}" genom hela boken.

Barnets ursprungliga idé (från starten av boken) är:
"${state.last_prompt || ""}"

Här är en kort översikt över vad som hänt i berättelsen hittills:
${recap}

Du ska nu skriva KAPITEL ${nextChapter} i SAMMA berättelse.

Viktigt om strukturen för kapitlet:
- Fortsätt direkt från slutet av föregående kapitel (utifrån stycket ovan).
- Starta inte om med en helt ny dag eller en helt ny historia om samma figur.
- Upprepa inte samma morgon, samma första skoldag eller samma skattjakt som redan hänt.
- Skriv kapitlet så att det har en tydlig början, en mitt och ett slut.

Längd:
- ${baseLengthInstr}
- Kapitlet ska ungefär motsvara ${lengthHint} i högläsningstid för barn.

Tydligt slut:
- Avsluta alltid kapitlet med en fullständig mening som slutar med punkt.
- Avsluta inte mitt i en mening.

${endingInstr}

Tonalitet:
- Språket ska vara enkelt, tydligt och tryggt för barn i åldern ${ageLabel}.
- Håll en positiv och hoppfull ton, även när det är lite spännande.
- Undvik brutalt våld, död eller skrämmande detaljer.

Önskemål från barnet (väv in detta naturligt i kapitlet, utan att starta om berättelsen):
${wishText ? `- "${wishText}"` : "- (inga extra önskemål just nu)"}
    `.trim();

    return prompt;
  }

  // -------------------------------------------------------
  // Ladda befintlig bok eller skapa ny från formuläret
  // (används av ws_button.dev.js)
  // -------------------------------------------------------
  function loadOrCreateFromForm() {
    let state = loadWS();
    if (state && typeof state === "object") return state;
    state = createWorldFromForm();
    saveWS(state);
    return state;
  }

  // -------------------------------------------------------
  // Lägg till kapitel + spara direkt
  // (används av ws_button.dev.js)
  // -------------------------------------------------------
  function addChapterAndSave(state, chapterText, wishText) {
    let next = addChapterToWS(state, chapterText);
    if (!next) return state;
    if (wishText && typeof wishText === "string") {
      next.last_wish = wishText.trim();
    }
    saveWS(next);
    return next;
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
  // Exportera globalt — API som ws_button.dev.js förväntar sig
  // -------------------------------------------------------
  window.WS_DEV = {
    load: loadWS,
    save: saveWS,
    createWorldFromForm,
    addChapterToWS,
    buildWsPrompt,
    reset: resetWS,
    loadOrCreateFromForm,
    addChapterAndSave
  };
})();
