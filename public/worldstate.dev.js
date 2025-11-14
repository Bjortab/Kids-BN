// ==========================================================
// BN-KIDS WS DEV — worldstate.dev.js (v3)
// Lokal "bok" i localStorage, kapitel för kapitel
// ==========================================================

(function () {
  'use strict';

  // Ny nyckel => vi slipper gamla trasiga objekt
  const STORAGE_KEY = 'bn_kids_ws_book_v3';

  // -------------------------------------------------------
  // Hjälpare: safe parse & normalisera struktur
  // -------------------------------------------------------
  function safeParse(raw) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;

      if (!Array.isArray(parsed.chapters)) {
        parsed.chapters = [];
      }
      if (!parsed.meta || typeof parsed.meta !== 'object') {
        parsed.meta = {};
      }
      return parsed;
    } catch (e) {
      console.warn('[WS] kunde inte parsa world state', e);
      return null;
    }
  }

  // -------------------------------------------------------
  // Ladda world state (bok) från localStorage
  // -------------------------------------------------------
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return safeParse(raw);
    } catch (e) {
      console.warn('[WS] kunde inte läsa world state', e);
      return null;
    }
  }

  // -------------------------------------------------------
  // Spara world state
  // -------------------------------------------------------
  function save(state) {
    if (!state || typeof state !== 'object') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('[WS] kunde inte spara world state', e);
    }
  }

  // -------------------------------------------------------
  // Skapa nytt world-state från UI-formuläret
  // (Använder dina faktiska id:n: age, hero, length, prompt)
  // -------------------------------------------------------
  function createWorldFromForm() {
    const ageSel    = document.getElementById('age');
    const heroInput = document.getElementById('hero');
    const lengthSel = document.getElementById('length');
    const promptEl  = document.querySelector('[data-id="prompt"]');

    const ageValue    = ageSel?.value || '';
    const ageLabel    = ageSel?.selectedOptions?.[0]?.textContent?.trim() || '';
    const hero        = (heroInput?.value || '').trim();
    const lengthValue = lengthSel?.value || '';
    const lengthLabel = lengthSel?.selectedOptions?.[0]?.textContent?.trim() || '';
    const prompt      = (promptEl?.value || '').trim();

    const world = {
      meta: {
        ageValue,
        ageLabel,
        hero,
        lengthValue,
        lengthLabel,
        basePrompt: prompt
      },
      chapters: [],
      last_prompt: prompt,
      created_at: Date.now()
    };

    return world;
  }

  // -------------------------------------------------------
  // Ladda befintlig bok – eller skapa ny från formuläret
  // -------------------------------------------------------
  function loadOrCreateFromForm() {
    const existing = load();
    if (existing) return existing;

    const fresh = createWorldFromForm();
    save(fresh);
    return fresh;
  }

  // -------------------------------------------------------
  // Lägg till nytt kapitel i state
  // -------------------------------------------------------
  function addChapterToWS(state, chapterText) {
    if (!state || typeof state !== 'object') {
      state = createWorldFromForm();
    }
    if (!Array.isArray(state.chapters)) {
      state.chapters = [];
    }

    if (chapterText && chapterText.trim()) {
      state.chapters.push({
        text: chapterText.trim(),
        added_at: Date.now()
      });
    }

    save(state);
    return state;
  }

  // -------------------------------------------------------
  // Bygg WS-prompt baserat på tidigare kapitel
  // TÅL att meta/chapter saknas / är konstiga
  // -------------------------------------------------------
  function buildWsPrompt(state) {
    // Tål skräp från gammal localStorage
    if (!state || typeof state !== 'object') {
      state = createWorldFromForm();
    }
    if (!state.meta || typeof state.meta !== 'object') {
      state.meta = {};
    }
    if (!Array.isArray(state.chapters)) {
      state.chapters = [];
    }

    const heroRaw      = state.meta.hero ?? '';
    const hero         = String(heroRaw).trim() || 'hjälten';
    const ageLabelRaw  = state.meta.ageLabel ?? '';
    const ageLabel     = String(ageLabelRaw).trim() || '7–8 år';
    const basePrompt   = state.meta.basePrompt || state.last_prompt || '';

    let recap;
    if (!state.chapters.length) {
      recap = basePrompt
        ? `Boken har ännu inte några kapitel. Barnets önskan är: ${basePrompt}`
        : 'Detta är första kapitlet. Inga tidigare händelser finns.';
    } else {
      recap = state.chapters
        .map((c, i) => {
          const t = (c.text || '').trim();
          return `Kapitel ${i + 1}: ${t}`;
        })
        .join('\n\n');
    }

    const nextChapter = state.chapters.length + 1;

    const prompt = `
Du är en barnboksförfattare.
Du skriver en kapitelbok på svenska för barn i åldern ${ageLabel}.
Huvudpersonen heter ${hero} och ska alltid kallas "${hero}" genom hela boken.

Barnets ursprungliga önskan om sagan var:
"${basePrompt || 'ingen specifik önskan angiven.'}"

Här är en sammanfattning av de tidigare kapitlen:
${recap}

Skriv nu KAPITEL ${nextChapter}.
- Fortsätt berättelsen logiskt från tidigare händelser.
- Upprepa inte exakt samma början eller samma scener som redan hänt.
- Använd samma huvudperson "${hero}" och samma värld.
- Håll språket enkelt, tydligt och tryggt för barn i åldern ${ageLabel}.
- Avsluta kapitlet med ett tydligt men gärna lite spännande slut (en krok för nästa kapitel, ingen total reset).
    `.trim();

    return prompt;
  }

  // -------------------------------------------------------
  // Nollställ bok (debug)
  // -------------------------------------------------------
  function resetWS() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn('[WS] kunde inte rensa world state', e);
    }
  }

  // -------------------------------------------------------
  // Exportera globalt
  // -------------------------------------------------------
  window.WS_DEV = {
    load,
    save,
    createWorldFromForm,
    loadOrCreateFromForm,
    addChapterToWS,
    buildWsPrompt,
    reset: resetWS
  };

})();
