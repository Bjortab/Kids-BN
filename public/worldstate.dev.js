<script>
// ==========================================================
// BN-KIDS WS DEV — worldstate.dev.js (v3)
// Håller koll på "boken" i localStorage, kapitel för kapitel
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
  // (använder dina riktiga id:n + data-id)
// -------------------------------------------------------
  function createWorldFromForm() {
    const ageSel    = document.getElementById("age");
    const heroInput = document.getElementById("hero");
    const lengthSel = document.getElementById("length");
    const promptEl  = document.querySelector("[data-id='prompt']");

    const ageValue   = ageSel && ageSel.value ? ageSel.value : "";
    const ageLabel   = (ageSel && ageSel.selectedOptions && ageSel.selectedOptions[0])
      ? ageSel.selectedOptions[0].textContent.trim()
      : "";

    const hero       = heroInput && heroInput.value
      ? heroInput.value.trim()
      : "";

    const lengthVal  = lengthSel && lengthSel.value ? lengthSel.value : "";
    const lengthLabel = (lengthSel && lengthSel.selectedOptions && lengthSel.selectedOptions[0])
      ? lengthSel.selectedOptions[0].textContent.trim()
      : "";

    const prompt     = promptEl && promptEl.value
      ? promptEl.value.trim()
      : "";

    return {
      meta: {
        ageValue:   ageValue,
        ageLabel:   ageLabel || "7–8 år",
        hero:       hero || "hjälten",
        lengthValue: lengthVal,
        lengthLabel: lengthLabel || "Mellan (≈5 min)"
      },
      chapters: [],          // varje kapitel: { text, added_at }
      last_prompt: prompt,   // ursprunglig / senaste önskan från barnet
      created_at: Date.now()
    };
  }

  // -------------------------------------------------------
  // Uppdatera world state med nytt kapitel
  // -------------------------------------------------------
  function addChapterToWS(state, chapterText) {
    if (!state) state = createWorldFromForm();
    if (!chapterText) return state;

    if (!Array.isArray(state.chapters)) state.chapters = [];

    state.chapters.push({
      text: chapterText,
      added_at: Date.now()
    });

    return state;
  }

  // -------------------------------------------------------
  // Liten summarizer: ta de 1–2 första meningarna per kapitel
  // så modellen fattar vad som hänt utan att drunkna i text.
// -------------------------------------------------------
  function summarizeChapter(text) {
    if (!text) return "";
    const parts = text.split(/(?<=[.!?])\s+/);
    if (parts.length <= 2) return text.trim();
    return (parts[0] + " " + parts[1]).trim();
  }

  // -------------------------------------------------------
  // Bygg WS-prompt baserat på tidigare kapitel + ev. önskan
  // -------------------------------------------------------
  function buildWsPrompt(state, userWish) {
    if (!state) return "";

    const hero     = (state.meta && state.meta.hero)     || "hjälten";
    const ageLabel = (state.meta && state.meta.ageLabel) || "7–8 år";

    const chapters = Array.isArray(state.chapters)
      ? state.chapters
      : [];

    const nextChapter = chapters.length + 1;

    // Sammanfattning av tidigare kapitel
    let recap = "Detta är första kapitlet.";

    if (chapters.length > 0) {
      const lines = chapters.map((c, i) => {
        const short = summarizeChapter(c.text);
        return `Kapitel ${i + 1}: ${short}`;
      });
      recap = lines.join("\n\n");
    }

    const wishText = (userWish && userWish.trim())
      ? `\n\nBarnet önskar nu att berättelsen ska ta en riktning ungefär så här:\n"${userWish.trim()}".\nFortsätt historien på ett naturligt sätt utifrån detta önskemål, utan att starta om eller ignorera tidigare händelser.\n`
      : "\n";

    const basePrompt = `
Du är en trygg och varm barnboksförfattare.
Du skriver en kapitelbok på svenska för barn i åldern ${ageLabel}.
Huvudpersonen heter ${hero} och ska ALLTID kallas "${hero}" genom hela boken.

Här är en kort sammanfattning av de tidigare kapitlen:
${recap}
${wishText}
Skriv nu KAPITEL ${nextChapter} i samma berättelse.

VIKTIGT:
- Fortsätt exakt där historien befinner sig, som om du skrev nästa kapitel i en bok.
- Börja INTE om från början, hitta inte på en ny bakgrund eller helt nya startscener.
- Återanvänd bara sådant som redan finns i berättelsen (miljöer, magiska föremål, fiender, vänner) på ett logiskt sätt.
- Håll fast vid samma ton, samma värld och samma huvudperson "${hero}".
- Avsluta kapitlet med en tydlig krok mot nästa kapitel (en spännande fråga eller situation),
  men utan att lösa ALLT eller hoppa direkt till ett slut på hela historien.
- Undvik att upprepa exakt samma formuleringar i varje kapitel (t.ex. samma morgonscen om och om igen).
    `.trim();

    return basePrompt;
  }

  // -------------------------------------------------------
  // Nollställ bok (för dev/console)
  // -------------------------------------------------------
  function resetWS() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      console.log("[WS DEV] reset – bok rensad");
    } catch (e) {
      console.warn("[WS DEV] kunde inte rensa world state", e);
    }
  }

  // -------------------------------------------------------
  // Exportera globalt
  // -------------------------------------------------------
  window.WS_DEV = {
    load: loadWS,
    save: saveWS,
    createWorldFromForm: createWorldFromForm,
    addChapterToWS: addChapterToWS,
    buildWsPrompt: buildWsPrompt,
    reset: resetWS
  };

})();
</script>
