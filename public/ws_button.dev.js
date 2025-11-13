// public/ws_button.dev.js
// BN-Kids WS dev-spår v3 — frikopplad från app.js createstory.
// - Extra knapp bredvid "Skapa saga".
// - Bygger world state + barnets önskan till en tydlig prompt.
// - Anropar /api/generate_story direkt och skriver till [data-id="story"].

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
    const heroRaw = (ui.hero || '').trim();
    const hero = heroRaw || 'hjälten';
    const age    = (ui.age || '').trim()    || 'okänd ålder';
    const length = (ui.length || '').trim() || 'okänd längd';
    const recap  = (ws.recap || '').trim()  || 'Ingen tidigare berättelse eller recap ännu.';

    return {
      hero,
      text: `Världssammanfattning:
- Huvudperson: ${hero}
- Ålder / nivå: ${age}
- Önskad berättelselängd: ${length}
- Senaste händelser: ${recap}
Regler för berättelsen:
- Huvudpersonen SKA heta "${hero}" genom hela berättelsen.
- Återanvänd platser och personer från recap om det är rimligt.
- Inga plötsliga nya krafter eller fakta som motsäger recap.
- Skriv på tydlig svenska för barn, utan onödiga klyschor.
- Avsluta berättelsen med ett tydligt, lugnt slut (ingen cliffhanger).`
    };
  }

  // Egen variant av lengthToMinutes (samma logik som app.js)
  function lengthToMinutesVal(val) {
    const len = (val || '').trim();
    if (!len) return 5;
    if (len === 'short') return 3;
    if (len === 'medium') return 5;
    if (len === 'long') return 12;
    return 5;
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

    wsBtn.addEventListener('click', async () => {
      const promptEl   = document.querySelector('[data-id="prompt"]');
      const ageSel     = document.getElementById('age');
      const heroEl     = document.getElementById('hero');
      const lengthSel  = document.getElementById('length');
      const storyEl    = document.querySelector('[data-id="story"]');
      const errEl      = document.querySelector('[data-id="error"]');
      const spinnerEl  = document.querySelector('[data-id="spinner"]');

      if (!promptEl) {
        console.warn('[WS] Hittar inte prompt-fältet');
        if (errEl) errEl.textContent = 'WS: Hittar inte prompt-fältet.';
        return;
      }

      const ui = {
        hero:   heroEl && heroEl.value ? heroEl.value : '',
        age:    (ageSel && ageSel.selectedOptions[0]) ? ageSel.selectedOptions[0].textContent : '',
        ageValue: ageSel && ageSel.value ? ageSel.value : '',
        length: (lengthSel && lengthSel.selectedOptions[0]) ? lengthSel.selectedOptions[0].textContent : '',
        lengthValue: lengthSel && lengthSel.value ? lengthSel.value : ''
      };

      const ws = loadWS();
      const basePrompt = (promptEl.value || '').trim();
      const summaryObj = buildSummary(ws, ui);
      const heroName = summaryObj.hero;

      const combinedPrompt = `
Du är en berättare som skriver en sammanhängande barnsaga på svenska för åldersgruppen ${ui.age || ui.ageValue || '7–8 år'}.
Huvudpersonen ska alltid heta "${heroName}" genom hela berättelsen.

Följ världssammanfattningen noggrant, bryt inte mot tidigare fakta och se till att:
- namnet "${heroName}" används konsekvent
- berättelsen får ett tydligt, tryggt slut (ingen cliffhanger)
- tonen passar barn i åldern ${ui.age || ui.ageValue || '7–8 år'}

${summaryObj.text}

Barnets önskan med sagan:
${basePrompt || '(ingen extra önskan angiven)'}`.trim();

      const mins = lengthToMinutesVal(ui.lengthValue);
      const body = {
        mins,
        lang: 'sv',
        prompt: combinedPrompt,
        agename: ui.age || ui.ageValue || '',
        hero: heroName
      };

      try {
        if (errEl) errEl.textContent = '';
        if (spinnerEl) {
          spinnerEl.style.display = 'flex';
          spinnerEl.textContent = 'Skapar WS-berättelse...';
        }
        wsBtn.disabled = true;

        const res = await fetch('/api/generate_story', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(body)
        });

        const txt = await res.text();
        let data = {};
        try {
          data = JSON.parse(txt);
        } catch (e) {
          console.warn('[WS] Kunde inte läsa JSON, body=', txt.slice(0, 200));
          throw new Error('WS: ogiltigt JSON-svar från servern.');
        }

        const storyText = data.story || data.text || data.story_text || '';
        if (!storyText) {
          console.warn('[WS] Svar saknar story-fält', data);
          throw new Error('WS: servern skickade ingen berättelsetext.');
        }

        if (storyEl) storyEl.textContent = storyText;

        // recap uppdateras via observern
      } catch (e) {
        console.error('[WS] fel vid WS-skapande', e);
        if (errEl) errEl.textContent = e.message || 'WS: kunde inte skapa berättelse.';
      } finally {
        if (spinnerEl) {
          spinnerEl.style.display = 'none';
          spinnerEl.textContent = '';
        }
        wsBtn.disabled = false;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupButton();
    setupObserver();
  });
})();
