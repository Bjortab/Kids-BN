// ==========================================================
// BN-KIDS WS DEV — worldstate.dev.js (GC v3)
// Lokal "bok" i localStorage, kapitel för kapitel
// ==========================================================

(function () {
  const STORAGE_KEY = "bn_kids_ws_book_v1";

  // -------------------------------------------------------
  // Ladda world state (bok) från localStorage
  // -------------------------------------------------------
  function load() {
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
  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("[WS DEV] kunde inte spara world state", e);
    }
  }

  // -------------------------------------------------------
  // Skapa ny bok från formuläret (ålder, hjälte, längd, prompt)
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

    const lengthValue = lengthSel && lengthSel.value ? lengthSel.value : "";
    const lengthText =
      lengthSel &&
      lengthSel.selectedOptions &&
      lengthSel.selectedOptions[0] &&
      lengthSel.selectedOptions[0].textContent
        ? lengthSel.selectedOptions[0].textContent.trim()
        : "";

    const prompt =
      promptEl && promptEl.value ? promptEl.value.trim() : "";

    return {
      meta: {
        ageValue,
        ageLabel: ageText,
        hero,
        lengthValue,
        lengthLabel: lengthText
      },
      chapters: [],          // varje kapitel: { text, added_at }
      last_prompt: prompt,   // senaste önskemålet från användaren
      created_at: Date.now()
    };
  }

  // -------------------------------------------------------
  // Lägg till kapitel i befintlig bok
  // -------------------------------------------------------
  function addChapter(state, chapterText) {
    if (!state) state = { meta: {}, chapters: [], created_at: Date.now() };
    if (!Array.isArray(state.chapters)) state.chapters = [];
    if (!chapterText || !chapterText.trim()) return state;

    state.chapters.push({
      text: chapterText.trim(),
      added_at: Date.now()
    });
    return state;
  }

  // -------------------------------------------------------
  // Skapa recap + prompt till nästa kapitel
  // options:
  //   - wish: extra önskemål från användaren (valfritt)
  //   - wantEnding: true = försök knyta ihop berättelsen
  // -------------------------------------------------------
  function buildPrompt(state, options) {
    options = options || {};
    const wish = options.wish || "";
    const wantEnding = !!options.wantEnding;

    if (!state) state = { meta: {}, chapters: [] };

    const hero =
      (state.meta && state.meta.hero && state.meta.hero.trim()) ||
      "hjälten";
    const ageLabel =
      (state.meta && state.meta.ageLabel && state.meta.ageLabel.trim()) ||
      "7–8 år";

    const chapters = Array.isArray(state.chapters) ? state.chapters : [];
    const nextChapter = chapters.length + 1;

    let recap = "Detta är första kapitlet.\n";
    if (chapters.length > 0) {
      // Kort recap: första + senaste + kapitelnummer
      const first = chapters[0].text;
      const last = chapters[chapters.length - 1].text;

      function shortSlice(txt) {
        if (!txt) return "";
        const t = txt.replace(/\s+/g, " ").trim();
        return t.length > 300 ? t.slice(0, 300) + " ..." : t;
      }

      recap =
        "Kort sammanfattning av berättelsen hittills:\n\n" +
        "Början: " +
        shortSlice(first) +
        "\n\n" +
        "Senaste kapitel: " +
        shortSlice(last);
    }

    let wishLine = "";
    if (wish) {
      wishLine =
        `\n\nBarnet har ett speciellt önskemål för nästa kapitel: ` +
        `"${wish}". Försök väva in detta naturligt i handlingen.`;
    }

    let endingLine = "";
    if (wantEnding) {
      endingLine =
        "\n\nDetta ska vara sista kapitlet i boken. " +
        "Knyt ihop berättelsen på ett tryggt och tydligt sätt, " +
        "utan ny stor cliffhanger. Avsluta med att huvudpersonen känner sig trygg och nöjd.";
    } else {
      endingLine =
        "\n\nAvsluta kapitlet med en liten cliffhanger eller känsla av förväntan, " +
        "så att man vill läsa nästa kapitel, men utan att börja om berättelsen från början.";
    }

    return (
      `Du är en trygg och fantasifull barnboksförfattare.` +
      `\nDu skriver en kapitelbok på svenska för barn i åldern ${ageLabel}.` +
      `\nHuvudpersonen heter ${hero} och ska konsekvent kallas "${hero}" genom hela boken.` +
      `\n\n${recap}` +
      `\n\nSkriv nu KAPITEL ${nextChapter}.` +
      `\n- Fortsätt berättelsen logiskt från tidigare händelser.` +
      `\n- Upprepa inte exakt samma början eller samma scener som redan har hänt.` +
      `\n- Använd samma huvudperson "${hero}" och samma värld.` +
      `\n- Håll språket enkelt, tydligt och tryggt för barn i åldern ${ageLabel}.` +
      wishLine +
      endingLine
    );
  }

  // -------------------------------------------------------
  // Nollställ bok (t.ex. via "Rensa"-knappen)
  // -------------------------------------------------------
  function reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      console.log("[WS DEV] world state reset");
    } catch (e) {
      console.warn("[WS DEV] kunde inte reseta world state", e);
    }
  }

  // -------------------------------------------------------
  // Exportera globalt
  // -------------------------------------------------------
  window.WS_DEV = {
    load,
    save,
    createWorldFromForm,
    addChapter,
    buildPrompt,
    reset
  };
})();
