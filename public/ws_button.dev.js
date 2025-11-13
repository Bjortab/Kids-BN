// public/ws_button.dev.js
// BN-Kids WS dev – kapitelbok-läge v4
// - Extra knapp bredvid "Skapa saga".
// - World state i localStorage: vem, ålder, vilket kapitel, recap.
// - Varje klick skriver NÄSTA KAPITEL i samma bok, inte samma saga igen.

(function () {
  const STORAGE_KEY = 'bn_kids_ws_book_v1';

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

  // Gör en enkel recap av ett kapitel: första + sista meningarna
  function makeChapterRecap(text) {
    if (!text) return '';
    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(Boolean);

    if (!sentences.length) return text.slice(0, 200);

    const first = sentences[0];
    const last = sentences.length > 1 ? sentences[sentences.length - 1] : '';
    if (last && last !== first) {
      return `${first} ${last}`;
    }
    return first;
  }

  function buildSummary(ws, ui) {
    const heroRaw = (ui.hero || '').trim();
    const hero = heroRaw || ws.bookHero || 'hjälten';
    const ageLabel = (ui.age || ui.ageValue || ws.bookAge || '7–8 år');
    const chapter = ws.chapter || 0;
    const nextChapter = chapter + 1;
    const recap = (ws.recap || '').trim() || 'Inget har hänt ännu, detta är första kapitlet.';

    return {
      hero,
      nextChapter,
      text: `Detta är en kapitelbok för barn i åldern ${ageLabel}.
Huvudpersonen heter ${hero} och ska ALLTID kallas "${hero}" genom hela boken.

Hittills i boken (sammanfattning):
${recap}

Uppgift:
- Skriv kapitel ${nextChapter} i samma bok.
- ANVÄND samma huvudperson "${hero}" och samma värld.
- Börja direkt i en ny situation eller scen – upprepa inte hur dagen startade, hur soligt det var, eller samma första möte om och om igen.
- Du får gärna kort nämna vad som hände tidigare ("Efter allt som hänt..."), men nu ska något NYTT hända.
- Håll koll på vad som är rimligt: ge inte ${hero} plötsligt nya krafter eller fakta som motsäger det som hänt.
- Avsluta kapitlet med ett tydligt, lugnt slut som känns färdigt, men lämna gärna en liten krok för nästa äventyr.
- Skriv på tydlig, enkel svenska för barn. Undvik klyschiga fraser och "AI-liknande" formuleringar.`
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

  function setupButton() {
    const createBtn = document.querySelector('[data-id="btn-create"]');
    if (!createBtn || !createBtn.parentNode) {
      console.warn('[WS] Hittar inte btn-create');
      return;
    }

    // Skapa bara knappen en gång
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
      const heroName   = summaryObj.hero;
      const nextChapter = summaryObj.nextChapter;

      const combinedPrompt = `
Du är en barnboksförfattare som skriver en kapitelbok på svenska för åldersgruppen ${ui.age || ui.ageValue || ws.bookAge || '7–8 år'}.

Skriv nu KAPITEL ${nextChapter}.
Huvudpersonen heter "${heroName}" och ska heta så genom hela kapitlet.

${summaryObj.text}

Barnets önskan med sagan:
${basePrompt || '(ingen extra önskan angiven)'}`.trim();

      const mins = lengthToMinutesVal(ui.lengthValue);
      const body = {
        mins,
        lang: 'sv',
        prompt: combinedPrompt,
        agename: ui.age || ui.ageValue || ws.bookAge || '',
        hero: heroName
      };

      try {
        if (errEl) errEl.textContent = '';
        if (spinnerEl) {
          spinnerEl.style.display = 'flex';
          spinnerEl.textContent = 'Skapar kapitel (WS dev)...';
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

        // Uppdatera world state för nästa kapitel
        const newWS = loadWS();
        newWS.bookHero = heroName;
        newWS.bookAge  = ui.age || ui.ageValue || newWS.bookAge || '';
        newWS.chapter  = (newWS.chapter || 0) + 1;
        newWS.recap    = makeChapterRecap(storyText);
        saveWS(newWS);

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
  });
})();
