// public/ws_button.dev.js
// BN-Kids WS dev-spår v1 — rör INTE befintlig prod-logik.
// - Lägger till en extra knapp bredvid "Skapa saga".
// - Knappen bygger en world state-sammanfattning + din prompt.
// - Använder window.createstory(), så allt backend-flöde är oförändrat.

(function () {
  const STORAGE_KEY = 'bn_kids_ws_v1';

  function loadWS() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
      console.warn('[WS] kunde inte läsa world state', e);
      return {};
    }
  }

  function saveWS(ws) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ws || {}));
    } catch (e) {
      console.warn('[WS] kunde inte spara world state', e);
    }
  }

  function buildSummary(ws, ui) {
    const hero   = (ui.hero || '').trim()   || 'hjälten';
    const age    = (ui.age || '').trim()    || 'okänd ålder';
    const length = (ui.length || '').trim() || 'okänd längd';
    const recap  = (ws.recap || '').trim()  || 'Ingen tidigare berättelse eller recap ännu.';

    return `Världssammanfattning:
- Hjälte: ${hero}
- Ålder / nivå: ${age}
- Önskad längd: ${length}
- Senaste händelser: ${recap}
Regler: inga plötsliga nya förmågor utan förklaring, konsekventa namn och platser, fysik/magi ska ha tydliga regler, undvik klyschiga moralslut.`;
  }

  function setupObserver() {
    const storyEl = document.querySelector('[data-id="story"]');
    if (!storyEl || typeof MutationObserver === 'undefined') return;

    const obs = new MutationObserver(() => {
      const text = (storyEl.textContent || '').trim();
      if (!text || text.length < 40) return;

      const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
      const recap = sentences.slice(0, 2).join(' ');
      if (!recap) return;

      const ws = loadWS();
      ws.recap = recap;
      saveWS(ws);
    });

    obs.observe(storyEl, { childList: true, characterData: true, subtree: true });
  }

  function setupButton() {
    const createBtn = document.querySelector('[data-id="btn-create"]');
    if (!createBtn || !createBtn.parentNode) {
      console.warn('[WS] Hittar inte btn-create');
      return;
    }

    // Om knappen redan finns, skapa inte en till
    if (document.querySelector('[data-id="btn-create-ws"]')) return;

    const wsBtn = document.createElement('button');
    wsBtn.type = 'button';
    wsBtn.textContent = 'Skapa saga (WS dev)';
    wsBtn.setAttribute('data-id', 'btn-create-ws');
    wsBtn.className = createBtn.className || 'btn-primary';
    wsBtn.style.marginLeft = '8px';

    createBtn.parentNode.insertBefore(wsBtn, createBtn.nextSibling);

    wsBtn.addEventListener('click', () => {
      const promptEl  = document.querySelector('[data-id="prompt"]');
      const ageSel    = document.getElementById('age');
      const heroEl    = document.getElementById('hero');
      const lengthSel = document.getElementById('length');
      const errEl     = document.querySelector('[data-id="error"]');

      if (!promptEl) {
        console.warn('[WS] Hittar inte prompt-fältet');
        if (errEl) errEl.textContent = 'WS: Hittar inte prompt-fältet.';
        return;
      }

      const ui = {
        hero:   heroEl && heroEl.value ? heroEl.value : '',
        age:    (ageSel && ageSel.selectedOptions[0]) ? ageSel.selectedOptions[0].textContent : '',
        length: (lengthSel && lengthSel.selectedOptions[0]) ? lengthSel.selectedOptions[0].textContent : ''
      };

      const ws = loadWS();
      const basePrompt = promptEl.value || '';
      const summary = buildSummary(ws, ui);

      const combinedPrompt = `${summary}

Berättelseönskan från barnet:
${basePrompt}`.trim();

      if (typeof window.createstory !== 'function') {
        console.warn('[WS] window.createstory saknas');
        if (errEl) errEl.textContent = 'WS: createstory-funktion saknas.';
        return;
      }

      const originalPrompt = promptEl.value;
      promptEl.value = combinedPrompt;

      try {
        window.createstory();
      } catch (e) {
        console.error('[WS] fel vid createstory()', e);
        if (errEl) errEl.textContent = 'WS: fel vid skapande av saga.';
      } finally {
        // Återställ prompten så användaren ser sin egen text igen
        setTimeout(() => {
          promptEl.value = originalPrompt;
        }, 500);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupButton();
    setupObserver();
  });
})();
