// ==========================================================
// BN-KIDS WS DEV — ws_button.dev.js
// Hanterar knappen "Skapa saga (WS dev)"
// ==========================================================

(function () {
  'use strict';

  function $(sel) { return document.querySelector(sel); }

  function getSpinner() {
    return document.querySelector('[data-id="spinner"]');
  }

  function getErrorBox() {
    return document.querySelector('[data-id="error"]');
  }

  function getStoryEl() {
    return document.querySelector('[data-id="story"]');
  }

  function showSpinner(show, text) {
    const sp = getSpinner();
    if (!sp) return;
    sp.style.display = show ? 'block' : 'none';

    const firstSpan = sp.querySelector('span');
    if (show && text && firstSpan) {
      firstSpan.textContent = text;
    }
  }

  function setError(msg) {
    const el = getErrorBox();
    if (!el) return;
    if (!msg) {
      el.style.display = 'none';
      el.textContent = '';
    } else {
      el.style.display = 'block';
      el.textContent = msg;
    }
  }

  // -------------------------------------------------------
  // Anropar ditt vanliga /api/generate_story men med WS-prompt
  // -------------------------------------------------------
  async function callGenerateStoryWsDev(wsPrompt) {
    // Hämta samma parametrar som din vanliga createstory använder
    const ageSel    = document.getElementById('age');
    const heroInput = document.getElementById('hero');
    const lengthSel = document.getElementById('length');

    const age  = ageSel?.value || '';
    const hero = (heroInput?.value || '').trim();
    const mins = lengthSel?.value || 'medium';
    const lang = 'sv';

    const body = {
      age,
      hero,
      prompt: wsPrompt,
      mins,
      lang,
      mode: 'ws_dev'
    };

    const res = await fetch('/api/generate_story', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error('generate_story WS dev failed: ' + res.status + ' ' + txt.slice(0, 200));
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      const txt = await res.text().catch(() => '');
      throw new Error('Kunde inte läsa JSON från WS dev: ' + txt.slice(0, 200));
    }

    if (!data || !data.story) {
      throw new Error('WS dev-svar saknar story-fält.');
    }

    return data.story;
  }

  // -------------------------------------------------------
  // Klick på "Skapa saga (WS dev)"
  // -------------------------------------------------------
  async function handleWsClick(ev) {
    ev.preventDefault();
    setError('');

    if (!window.WS_DEV) {
      setError('WS_DEV saknas – dev-kod kunde inte laddas.');
      return;
    }

    // Skapa / ladda world state baserat på form
    const world = window.WS_DEV.loadOrCreateFromForm();
    const wsPrompt = window.WS_DEV.buildWsPrompt(world);

    showSpinner(true, 'Skapar kapitel…');
    const btn = ev.currentTarget;
    const prevDisabled = btn.disabled;
    btn.disabled = true;

    try {
      const storyText = await callGenerateStoryWsDev(wsPrompt);

      // Spara kapitlet i world state
      const updated = window.WS_DEV.addChapterToWS(world, storyText);
      console.log('[WS DEV] chapters now:', updated && updated.chapters);

      // Visa senaste kapitel i rutan
      const storyEl = getStoryEl();
      if (storyEl) {
        storyEl.textContent = storyText;
      }
    } catch (e) {
      console.error('[WS DEV] error', e);
      setError('Något gick fel i WS dev: ' + (e.message || e));
    } finally {
      btn.disabled = prevDisabled;
      showSpinner(false);
    }
  }

  // -------------------------------------------------------
  // Binda knappen när DOM är redo
  // -------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('btn-ws-dev');
    if (!btn) {
      console.warn('[WS DEV] hittar inte btn-ws-dev i DOM:en');
      return;
    }
    btn.addEventListener('click', handleWsClick);
    console.log('[WS DEV] WS-knapp bunden');
  });

})();
