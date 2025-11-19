// ==========================================================
// BN-KIDS WS DEV — worldstate.dev.js (v8.2)
// Kapitelbok i localStorage + bättre kapitel- & ålderslogik
//
// - Varje klick på WS-knappen = nytt kapitel i samma bok
// - Kort recap (början + slut) så kapitlet hinner bli klart
// - Åldersstyrd längd + ton
// - Extra hård logik mot "omstarter" (kapitel 2+ får inte bli
//   en ny version av kapitel 1, även om prompten är samma)
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
  // Hämta ålder som siffra (för band-logik)
  // -------------------------------------------------------
  function inferAge(meta) {
    if (!meta) return 10;
    const candidates = [meta.ageValue, meta.ageLabel];
    for (let i = 0; i < candidates.length; i++) {
      const s = (candidates[i] || "").toString();
      const m = s.match(/(\d{1,2})/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n)) return n;
      }
    }
    return 10;
  }

  // -------------------------------------------------------
  // Skapa nytt world-state från UI-formuläret
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
      chapters: [],
      last_prompt: prompt,
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
  // Hjälpare för kortare recap
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
  // -------------------------------------------------------
  function buildWsPrompt(state, wishOrOpts) {
    if (!state) return "";

    // Önskemål från barnet
    let wishText = "";
    if (typeof wishOrOpts === "string") {
      wishText = wishOrOpts.trim();
    } else if (wishOrOpts && typeof wishOrOpts.wish === "string") {
      wishText = wishOrOpts.wish.trim();
    }

    const meta     = state.meta || {};
    const hero     = meta.hero || "hjälten";
    const ageLabel = meta.ageLabel || "7–8 år";
    const ageNum   = inferAge(meta);

    const chapters    = Array.isArray(state.chapters) ? state.chapters : [];
    const nextChapter = chapters.length + 1;

    // ---- Recap: början + slut på senaste kapitel ----
    let recap;
    if (chapters.length === 0) {
      recap = "Detta är början av berättelsen. Inga tidigare kapitel finns ännu.\n";
    } else {
      const first = chapters[0].text || "";
      const last  = chapters[chapters.length - 1].text || "";

      const firstShort = snippetStart(first, 220);
      const lastShort  = snippetEnd(last, 260);

      recap =
        "Så här började berättelsen (kort sammanfattning):\n" +
        firstShort +
        "\n\n" +
        "Så här slutade det senaste kapitlet (FORTSÄTT exakt härifrån, inte från början):\n" +
        lastShort +
        "\n";
    }

    const wishLower = wishText.toLowerCase();
    const isMaybeLast =
      wishLower.includes("sista kapitlet") ||
      wishLower.includes("avsluta berättelsen") ||
      wishLower.includes("avsluta boken") ||
      wishLower.includes("slutet på berättelsen") ||
      wishLower.includes("slutet på boken") ||
      wishLower.includes("gör ett slut") ||
      wishLower.includes("gör ett bra slut") ||
      wishLower.includes("sista delen");

    const lengthHint = meta.lengthLabel || "Mellan (≈5 min)";

    // Åldersband
    const isYoung = ageNum <= 10;
    const isMid   = ageNum >= 11 && ageNum <= 12;
    const isTeen  = ageNum >= 13;

    // Längdinstruktion
    let baseLengthInstr;
    if (isYoung) {
      baseLengthInstr =
        "Skriv ett kapitel på ungefär 6–10 meningar. " +
        "Det är viktigare att kapitlet känns tydligt och tryggt än att det är långt. " +
        "Avsluta med en fullständig mening.";
    } else if (isMid) {
      baseLengthInstr =
        "Skriv ett kapitel på ungefär 8–14 meningar. " +
        "Det är viktigare att kapitlet känns komplett än att det är långt. " +
        "Avsluta med en fullständig mening.";
    } else {
      baseLengthInstr =
        "Skriv ett kapitel på ungefär 10–18 meningar. " +
        "Ge scenen lite djup (känslor och detaljer), men avsluta hellre i tid " +
        "med en fullständig mening än att börja ett nytt sidospår.";
    }

    // Progressionsregler – undvik “ny första gång”
    let progressionRules;
    if (isYoung) {
      progressionRules = [
        "- Du får gärna repetera lite kort vad barnet lär sig (t.ex. cykla, våga prata eller simma),",
        "  men låt det ändå märkas att hjälten blir lite modigare för varje kapitel."
      ].join("\n");
    } else {
      progressionRules = [
        "- Det här är kapitel " + nextChapter + ", inte kapitel 1.",
        "- Utgå från att " + hero + " redan har lärt sig saker som beskrivits tidigare (t.ex. att våga cykla, våga simma,",
        "  använda en kraft eller stå upp för sig själv).",
        "- Upprepa inte samma första gång igen. Om förra kapitlet handlade om att våga något första gången,",
        "  ska det här kapitlet visa nästa steg: använda det modet i en ny situation eller hjälpa någon annan.",
        "- Skriv inte som om berättelsen börjar om. Undvik formuleringar som:",
        "  'Det var en gång', 'Det här var början på', 'En dag bestämde sig', 'För första gången',",
        "  om det redan har hänt i tidigare kapitel.",
        "- Gör inte hjälten plötsligt mycket osäkrare än i tidigare kapitel utan tydlig orsak i scenen."
      ].join("\n");
    }

    // Extra strikt instruktion för sista kapitlet
    let endingInstr;
    if (isMaybeLast) {
      if (isTeen || isMid) {
        endingInstr =
          "Detta ska vara SISTA kapitlet i boken. Knyt ihop de viktigaste trådarna och visa tydligt hur " +
          hero + " har utvecklats jämfört med början.\n" +
          "- Introducera INTE helt nya stora miljöer (ingen ny ö, ny planet, ny stad eller ny värld). " +
          "Använd de platser som redan finns i berättelsen.\n" +
          "- Introducera INTE nya viktiga huvudpersoner i sista kapitlet. Mindre biroller får nämnas kort, " +
          "men det är " + hero + "s resa som ska avslutas.\n" +
          "- Starta inte en helt ny skattjakt eller ett nytt stort äventyr. Allt som händer nu ska kännas som " +
          "en naturlig följd av det som hänt i tidigare kapitel.\n" +
          "- Ge ett lugnt, hoppfullt och tydligt slut utan att lämna stora obesvarade huvudfrågor.";
      } else {
        endingInstr =
          "Detta ska vara SISTA kapitlet i boken. Knyt ihop berättelsen på ett lugnt och tryggt sätt.\n" +
          "- Använd samma miljöer och vänner som tidigare.\n" +
          "- Hitta inte på ett helt nytt äventyr, utan visa hur det som redan har hänt får ett fint slut.\n" +
          "- Ge ett tydligt och hoppfullt slut där " + hero + " känner sig trygg.";
      }
    } else {
      // Mittenkapitel
      if (isTeen || isMid) {
        endingInstr =
          "Detta är ett MITTENKAPITEL. Avsluta kapitlet med en hel mening och en mjuk krok som gör att man vill " +
          "läsa nästa kapitel, men börja inte om berättelsen från början.\n" +
          "- Starta inte en ny första dag, ny första träning eller helt ny resa som ignorerar vad som hänt tidigare.\n" +
          "- Låt kapitlet fördjupa relationer, konsekvenser och känslor utifrån det som redan hänt.";
      } else {
        endingInstr =
          "Detta är ett MITTENKAPITEL. Avsluta kapitlet med en tydlig mening och en liten krok som gör att man " +
          "vill höra mer, men börja inte om exakt samma sak igen.";
      }
    }

    // Tonalitet
    let tonalitetInstr;
    if (isTeen) {
      tonalitetInstr = [
        "- Språket ska vara enkelt men kan ha lite mer djup, känslor och tankar typiskt för tonåringar.",
        "- Håll en hoppfull ton, men det är okej med lite allvar så länge det inte blir mörkt eller brutalt.",
        "- Undvik grovt våld, död eller detaljerad skräck."
      ].join("\n");
    } else if (isMid) {
      tonalitetInstr = [
        "- Språket ska vara tydligt och tryggt men kan innehålla lite mer känslor och nyanser.",
        "- Håll en positiv och hoppfull ton, även när det är spännande.",
        "- Undvik brutalt våld, död eller skrämmande detaljer."
      ].join("\n");
    } else {
      tonalitetInstr = [
        "- Språket ska vara mycket enkelt, tydligt och tryggt.",
        "- Håll en varm och hoppfull ton, även när något är lite spännande.",
        "- Undvik våld, död eller sådant som kan kännas skrämmande."
      ].join("\n");
    }

    const basePrompt = `
Du är en varm och trygg barnboksförfattare.
Du skriver en kapitelbok på svenska för barn i åldern ${ageLabel}.
Huvudpersonen heter ${hero} och ska alltid kallas "${hero}" genom hela boken.

Barnets ursprungliga idé (från starten av boken) är:
"${state.last_prompt || ""}"

Här är en kort översikt över vad som hänt i berättelsen hittills:
${recap}

Du ska nu skriva KAPITEL ${nextChapter} i SAMMA berättelse.

Viktigt om strukturen för kapitlet:
- FORTSÄTT från slutet av föregående kapitel (texten ovan).
- Starta inte om med en helt ny dag eller en helt ny historia om samma figur.
- Upprepa inte samma första händelse (första cykelturen, första gången någon vågar något) om den redan hänt.
- Skriv kapitlet så att det har en tydlig början, en mitt och ett slut.
- Behandla detta som kapitel ${nextChapter}, inte kapitel 1.

Längd:
- ${baseLengthInstr}
- Kapitlet ska ungefär motsvara ${lengthHint} i högläsningstid för barn.

Utveckling och framsteg:
${progressionRules}

Tydligt slut på kapitlet:
- Avsluta alltid kapitlet med en fullständig mening som slutar med punkt.
- Avsluta inte mitt i en mening.

${endingInstr}

Tonalitet:
${tonalitetInstr}

Önskemål från barnet (väv in detta naturligt i kapitlet, utan att starta om berättelsen):
${wishText ? `- "${wishText}"` : "- (inga extra önskemål just nu)"}
    `.trim();

    return basePrompt;
  }

  // -------------------------------------------------------
  // Ladda befintlig bok eller skapa ny från formuläret
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
