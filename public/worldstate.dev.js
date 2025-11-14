// ==========================================================
// BN-KIDS WS DEV — worldstate.dev.js (v3.2)
// Lokal "bok" i localStorage, kapitel för kapitel
// - Kortare recap per kapitel (mindre tjat)
// - Tar hänsyn till barnets önskemål via "Sagoförslag"
// - Bättre hjälte-hantering (alltid riktigt namn, inte "hjälten/vännen")
// - Exponerar loadOrCreateFromForm() för ws_button.dev.js
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
        ageLabel: ageText,
        hero: hero,                // kan vara tomt, hanteras i buildWsPrompt
        lengthValue: lengthVal,
        lengthLabel: lengthText
      },
      chapters: [],                // varje kapitel: { text, added_at }
      last_prompt: prompt,         // ursprunglig idé / barnprompt
      created_at: Date.now()
    };
  }

  // -------------------------------------------------------
  // Helper: ladda befintlig bok, eller skapa ny från formuläret
  // (denna är vad ws_button.dev.js anropar)
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
  // Enkel recap: plocka ut första 1–2 meningarna ur kapitlet
  // och begränsa längden. Detta minskar tjat/repetition.
  // -------------------------------------------------------
  function makeChapterRecap(text) {
    if (!text || typeof text !== "string") return "";
    const trimmed = text.trim();
    if (!trimmed) return "";

    const sentences = trimmed.split(/(?<=[\.\!\?…])\s+/);
    const firstTwo = sentences.slice(0, 2).join(" ");
    const recap = firstTwo.length > 400 ? firstTwo.slice(0, 400) + "…" : firstTwo;

    return recap;
  }

  // -------------------------------------------------------
  // Bygg WS-prompt baserat på tidigare kapitel
  // - Kort recap per kapitel
  // - Tar med barnets önskemål för NÄSTA kapitel
  // - Säkerställer att huvudpersonen har ett riktigt namn
  // -------------------------------------------------------
  function buildWsPrompt(state) {
    if (!state) return "";

    const rawHero =
      state.meta && typeof state.meta.hero === "string"
        ? state.meta.hero.trim()
        : "";

    let hero = rawHero;
    let heroInstruction = "";

    if (!hero) {
      // Inget namn ifyllt → modellen får hitta på ETT namn
      hero = "huvudpersonen";
      heroInstruction = `
Hitta på ETT tydligt namn på huvudpersonen (t.ex. "Lina" eller "Oskar").
Använd DET namnet konsekvent genom hela kapitlet.
Kalla inte huvudpersonen bara "hjälten", "vännen", "pojken" eller "flickan".`;
    } else {
      // Namn ifyllt → använd exakt det
      heroInstruction = `
Huvudpersonen heter ${hero}.
Använd exakt namnet "${hero}" genom hela kapitlet.
Kalla inte huvudpersonen bara "hjälten", "vännen", "pojken" eller "flickan".`;
    }

    const ageLabel =
      (state.meta && state.meta.ageLabel && state.meta.ageLabel.trim()) ||
      "7–8 år";

    // Hämta barnets önskemål just nu från fältet "Sagoförslag"
    let nextWish = "";
    try {
      const promptEl = document.querySelector("[data-id='prompt']");
      if (promptEl && typeof promptEl.value === "string") {
        nextWish = promptEl.value.trim();
      }
    } catch (e) {
      console.warn("[WS] kunde inte läsa aktuellt önskemål från formuläret", e);
    }

    let recapSection = "";
    const chapters = Array.isArray(state.chapters) ? state.chapters : [];

    if (chapters.length === 0) {
      const baseIdea =
        (state.last_prompt && String(state.last_prompt).trim()) || "";
      if (baseIdea) {
        recapSection =
          "Detta är början på berättelsen. Barnets grundidé är:\n" +
          baseIdea +
          "\n\nInget har hänt än – detta är kapitel 1.";
      } else {
        recapSection =
          "Detta är början på berättelsen. Inget har hänt än – detta är kapitel 1.";
      }
    } else {
      recapSection = chapters
        .map((c, i) => {
          const recap = makeChapterRecap(c.text);
          return recap
            ? `Kapitel ${i + 1}: ${recap}`
            : `Kapitel ${i + 1}: (kort kapitel utan recap)`;
        })
        .join("\n\n");
    }

    const nextChapter = chapters.length + 1;

    let prompt = `
Du är en barnboksförfattare.
Du skriver en kapitelbok på svenska för barn i åldern ${ageLabel}.
${heroInstruction}

Här är en sammanfattning av de tidigare kapitlen:
${recapSection}

Skriv nu KAPITEL ${nextChapter} i den här boken.

Viktigt:
- Fortsätt berättelsen logiskt från tidigare händelser.
- Upprepa inte samma början, samma magiska föremål eller exakt samma scener om och om igen.
- Låt nya platser, personer, problem och lösningar dyka upp, men håll kvar samma värld och ton.
- Håll språket enkelt, tydligt och tryggt för barn i åldern ${ageLabel}.
- Avsluta kapitlet med ett tydligt men gärna lite spännande slut (en krok för nästa kapitel, ingen total reset).
`.trim();

    if (nextWish) {
      prompt += `

Barnets önskemål för JUST DETTA kapitel är:
"${nextWish}"

Försök väva in detta på ett naturligt sätt i handlingen, utan att bryta logiken i berättelsen.
`;
    }

    return prompt;
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
    loadOrCreateFromForm,
    addChapterToWS,
    buildWsPrompt,
    reset: resetWS
  };
})();
