// ==========================================================
// BN-KIDS WS DEV — worldstate.dev.js (v9a GC)
// - Kapitelbok i localStorage
// - Kort recap (början + slut) istället för full text
// - Stöd för "samma prompt igen" = FORTSÄTT, inte ny omstart
// - Sista kapitlet / avsluta boken = knyt ihop SAMMA berättelse
// ==========================================================

(function () {
  "use strict";

  const STORAGE_KEY = "bn_kids_ws_book_v1";

  // -------------------------------------------------------
  // Hjälp: normalisera text (för att jämföra prompts)
  // -------------------------------------------------------
  function normalizeText(txt) {
    if (!txt) return "";
    return String(txt)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

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
      ageSel &&
      ageSel.selectedOptions &&
      ageSel.selectedOptions[0]
        ? ageSel.selectedOptions[0].textContent.trim()
        : "";
    const hero       =
      heroInput && heroInput.value ? heroInput.value.trim() : "";
    const lengthVal  =
      lengthSel && lengthSel.value ? lengthSel.value : "";
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
        ageLabel: ageText || "7–8 år",
        hero: hero || "hjälten",
        lengthValue: lengthVal,
        lengthLabel: lengthText || "Mellan (≈5 min)"
      },
      chapters: [],           // varje kapitel: { text, added_at }
      last_prompt: prompt,    // ursprunglig / senaste barnprompt
      last_wish: prompt,      // senaste önskan som användes
      last_wish_norm: normalizeText(prompt),
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
  //  - "Samma prompt igen" → fortsätt, inte ny scen
  //  - Sista kapitlet → knyt ihop, INTE ny berättelse
  // -------------------------------------------------------
  function buildWsPrompt(state, wishOrOpts) {
    if (!state) return "";

    // 1) Plocka ut önskan från input
    let wishText = "";
    if (typeof wishOrOpts === "string") {
      wishText = wishOrOpts.trim();
    } else if (wishOrOpts && typeof wishOrOpts.wish === "string") {
      wishText = wishOrOpts.wish.trim();
    }

    const hero     = (state.meta && state.meta.hero) || "hjälten";
    const ageLabel = (state.meta && state.meta.ageLabel) || "7–8 år";

    const chapters = Array.isArray(state.chapters)
      ? state.chapters
      : [];
    const nextChapter = chapters.length + 1;

    // 2) Kolla om detta är samma önskan som senast
    const prevWishNorm    = normalizeText(state.last_wish);
    const currentWishNorm = normalizeText(wishText);
    const isRepeatedWish  =
      currentWishNorm &&
      prevWishNorm &&
      currentWishNorm === prevWishNorm;

    // Om samma prompt igen → behandla det som "ingen ny önskan"
    // men låt övergripande tema vara kvar i bakgrunden.
    let wishForModel = wishText;
    let wishMode      = "new";
    if (isRepeatedWish) {
      wishMode      = "continue";
      wishForModel  = ""; // trigga inte "ny variant av samma scen"
    }

    // 3) Recap
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
        "Så här började berättelsen (kort sammanfattning av startkapitlet):\n" +
        firstShort +
        "\n\n" +
        "Så här slutade det SENASTE kapitlet (du ska FORTSÄTTA härifrån, inte börja om):\n" +
        lastShort +
        "\n";
    }

    // 4) Kolla om detta ska vara sista kapitlet
    const combinedForEndCheck =
      (wishText || "").toLowerCase() +
      " " +
      (state.last_wish || "").toLowerCase();
    const isMaybeLast =
      combinedForEndCheck.includes("sista kapitlet") ||
      combinedForEndCheck.includes("sista kapitlet.") ||
      combinedForEndCheck.includes("avsluta berättelsen") ||
      combinedForEndCheck.includes("avsluta boken") ||
      combinedForEndCheck.includes("knyt ihop allt") ||
      combinedForEndCheck.includes("slutet på berättelsen") ||
      combinedForEndCheck.includes("slutet på boken");

    const lengthHint =
      (state.meta && state.meta.lengthLabel) || "Mellan (≈5 min)";

    const baseLengthInstr =
      "Skriv ett kapitel på ungefär 8–14 meningar. " +
      "Det är viktigare att kapitlet känns komplett än att det är långt. " +
      "Om du märker att du börjar närma dig slutet av din text, " +
      "avrunda kapitlet med en fullständig mening istället för att fortsätta.";

    const endingInstr = isMaybeLast
      ? [
          "Detta ska vara SISTA kapitlet i SAMMA berättelse som tidigare kapitel.",
          "Du får INTE starta ett nytt äventyr, byta miljö helt eller byta ut huvudpersonerna.",
          "Alla viktiga händelser, fiender, problem och mysterier som nämns i texten ovan ska räknas som sanna och ska knytas ihop här.",
          "Ge ett lugnt och hoppfullt slut och lämna inte kvar stora obesvarade frågor.",
          "Om du behöver nämna vad som hänt tidigare, gör det kortfattat i förbifarten, inte som en helt ny berättelse."
        ].join("\n- ")
      : "Detta är ett MITTENKAPITEL. Avsluta kapitlet med en hel mening och en mjuk krok " +
        "som gör att man vill läsa nästa kapitel, men börja inte om berättelsen från början.";

    // 5) Instruktioner kring önskan
    let wishLines;
    if (!wishForModel && wishMode === "continue") {
      // Samma prompt igen → förklara för modellen att det inte är en ny beställning
      wishLines =
        "- Barnet har INTE skrivit någon ny önskan denna gång. " +
        "Fortsätt bara berättelsen logiskt från förra kapitlet med samma övergripande tema.\n" +
        "- Upprepa inte samma träningsmoment, samma scen eller samma konflikt som redan skrevs i förra kapitlet, " +
        "om det inte finns en tydlig ny vändning.";
      if (isMaybeLast) {
        wishLines +=
          "\n- Barnet ber nu om ett slut på boken. Knyt ihop den PÅGÅENDE berättelsen, börja inte om från början.";
      }
    } else if (wishForModel) {
      wishLines =
        `- Barnets önskan för detta kapitel är: "${wishForModel}".\n` +
        "- Väv in denna önskan NATURLIGT i fortsättningen av den pågående berättelsen, utan att starta om.";
      if (isMaybeLast) {
        wishLines +=
          "\n- Denna önskan betyder att boken ska avslutas nu. " +
          "Avsluta den PÅGÅENDE berättelsen, inte en ny version.";
      }
    } else {
      wishLines =
        "- Barnet har inte angett någon särskild önskan. Fortsätt berättelsen där den slutade.";
      if (isMaybeLast) {
        wishLines +=
          "\n- Men behandla detta som sista kapitlet: knyt ihop den pågående berättelsen.";
      }
    }

    // 6) Själva systemprompten till modellen
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

Önskemål från barnet (hantera detta enligt instruktionerna nedan):
${wishLines}

Tonalitet:
- Språket ska vara enkelt, tydligt och tryggt för barn i åldern ${ageLabel}.
- Håll en positiv och hoppfull ton, även när det är lite spännande.
- Undvik brutalt våld, död eller skrämmande detaljer.
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

    if (typeof wishText === "string") {
      const trimmed = wishText.trim();
      if (trimmed) {
        next.last_wish      = trimmed;
        next.last_wish_norm = normalizeText(trimmed);
      }
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
