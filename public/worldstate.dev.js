// ==========================================================
// BN-KIDS WS DEV — worldstate.dev.js (v7.1 GC)
// Kapitelbok i localStorage + förbättrad kapitel-logik
//
// Den här filen:
//  - Lägger bara logik i PROMPTEN (ingen egen AI-magi)
//  - Tvingar modellen att ALLTID fortsätta samma berättelse
//  - Säger uttryckligen: "starta INTE om, även om barnets önskan ser ut
//    som en helt ny början"
//  - Förklarar att figurer måste vara konsekventa (en hund kan inte bli
//    människa i nästa kapitel, "vännen" måste få ett eget namn osv)
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
      ageSel &&
      ageSel.selectedOptions &&
      ageSel.selectedOptions[0]
        ? ageSel.selectedOptions[0].textContent.trim()
        : "";
    const hero       = heroInput && heroInput.value ? heroInput.value.trim() : "";
    const lengthVal  = lengthSel && lengthSel.value ? lengthSel.value : "";
    const lengthText =
      lengthSel &&
      lengthSel.selectedOptions &&
      lengthSel.selectedOptions[0]
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
      last_prompt: prompt,   // ursprungliga idén från barnet
      last_wish: "",         // senaste önskemålet
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
  //  - EXTREMT tydligt: fortsätt samma berättelse, starta inte om
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
        "Så här slutade det senaste kapitlet (DU MÅSTE FORTSÄTTA HÄRIFRÅN, inte från början):\n" +
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
        "Starta absolut INTE en helt ny berättelse i detta kapitel."
      : "Detta är ett MITTENKAPITEL. Avsluta kapitlet med en hel mening och en mjuk krok " +
        "som gör att man vill läsa nästa kapitel, men börja inte om berättelsen från början.";

    // ---- NYTT: MYCKET TYDLIGARE KONTINUITET + FIGUR-LOGIK ----
    const continuityRules = `
Väldigt viktiga regler för berättelsen:

- Du MÅSTE fortsätta exakt samma berättelse som i tidigare kapitel.
- Även om barnets nya önskan låter som en helt ny start (t.ex. "nu bor hjälten på månen"),
  ska du INTE starta om boken. Du ska istället föra in önskan som nästa steg i samma äventyr.
- Hoppa inte tillbaka till en ny "första skoldag", en ny "första gång de hittar kistan" osv.
- Skriv kapitlet så att det tydligt händer EFTER slutet på det senaste kapitlet.

Figurer och världen måste vara konsekventa:

- Om en figur redan är ett djur (t.ex. en hund), då är den en hund även i nästa kapitel.
  Den kan inte plötsligt bli en människa utan en tydlig, barnvänlig förklaring inne i berättelsen.
- Om du hittar på en vän till ${hero}, ge vännen ett EGET namn (t.ex. "Liva", "Sam", "Amir")
  och använd samma namn genom hela boken. Skriv inte bara "vännen" varje gång.
- Håll reda på viktiga platser (t.ex. källaren, kistan, skogen). Om barnets önskan vill
  flytta berättelsen till en ny plats, gör det som ett naturligt nästa steg:
  först avslutar du scenen där ni är, sedan tar ni er till den nya platsen.
`.trim();

    const wishInstr = `
Önskemål från barnet (väv in detta som NÄSTA STEG i samma berättelse – inte som en ny start):
${wishText ? `- "${wishText}"` : "- (inga extra önskemål just nu)"}
`.trim();

    // Själva systemprompten till modellen
    const prompt = `
Du är en varm och trygg barnboksförfattare.
Du skriver en kapitelbok på svenska för barn i åldern ${ageLabel}.
Huvudpersonen heter ${hero} och ska alltid kallas "${hero}" genom hela boken.

Barnets ursprungliga idé från början av boken är:
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

${continuityRules}

${wishInstr}

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
