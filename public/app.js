// app.js — robust init så knappar alltid triggar

(function () {
  // ====== Utils ======
  const $id = (id) => document.getElementById(id);
  const log = (...a) => { console.log('[BN]', ...a); };
  const err = (...a) => { console.error('[BN]', ...a); };

  function setStatus(msg) {
    const el = $id('statusText');
    if (el) el.textContent = msg || '';
  }
  function setOut(text, isError = false) {
    const box = $id('result');
    if (!box) return;
    box.style.color = isError ? '#ff6b6b' : '#ffffff';
    box.textContent = text || '';
  }

  async function postJSON(url, body, extraHeaders = {}) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    });
  }

  function attachAudioFromBlob(blob) {
    const old = $id('audioPlayer');
    if (old) old.remove();

    const url = URL.createObjectURL(blob);
    const audio = document.createElement('audio');
    audio.id = 'audioPlayer';
    audio.controls = true;
    audio.preload = 'auto';
    audio.src = url;

    const box = $id('result');
    if (box) box.insertAdjacentElement('afterend', audio);
    audio.play().catch(() => {});
  }

  async function handleTTSResponse(res) {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('audio/')) {
      const blob = await res.blob();
      attachAudioFromBlob(blob);
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (data && data.audioBase64) {
      const bin = atob(data.audioBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      attachAudioFromBlob(new Blob([bytes], { type: 'audio/mpeg' }));
      return;
    }
    throw new Error(data?.error || 'TTS gav inget ljud.');
  }

  // ====== Init efter att DOM finns ======
  document.addEventListener('DOMContentLoaded', () => {
    // Plocka inputs (med fallback-selektorer om id saknas)
    const nameInput = $id('childName') || document.querySelector('[name="childName"], #name, input[placeholder*="namn" i]');
    const ageInput  = $id('ageRange')  || document.querySelector('#age, select[name*="age" i]');
    const promptEl  = $id('prompt')    || document.querySelector('textarea, #storyPrompt');
    const heroInput = $id('heroName')  || document.querySelector('#hero, input[placeholder*="hjälte" i]');

    const btnSpeak    = $id('btnSpeak')    || document.querySelector('[data-btn="speak"], .btn-speak');
    const btnCreate   = $id('btnCreate')   || document.querySelector('[data-btn="create"], .btn-create');
    const btnSaveHero = $id('btnSaveHero') || document.querySelector('[data-btn="save-hero"], .btn-save-hero');
    const btnReset    = $id('btnResetHeroes') || document.querySelector('[data-btn="reset-heroes"], .btn-reset-heroes');

    // Säkerställ att inget form-submit trasslar
    const forms = document.querySelectorAll('form');
    forms.forEach(f => f.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      log('block form submit');
    }));

    log('init elements', { nameInput, ageInput, promptEl, heroInput, btnSpeak, btnCreate, btnSaveHero, btnReset });

    // ====== Skapa saga + TTS ======
    btnCreate?.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      try {
        btnCreate.disabled = true;
        const oldText = btnCreate.textContent;
        btnCreate.textContent = 'Skapar...';
        setStatus('Skapar saga…');

        const payload = {
          name:     (nameInput?.value || '').trim(),
          ageRange: (ageInput?.value || '').trim(),   // ex. "1–2"
          prompt:   (promptEl?.value || '').trim(),
          heroName: (heroInput?.value || '').trim(),
          quality:  'kids_v1'
        };

        if (!payload.prompt) {
          setOut('Skriv vad sagan ska handla om först.', true);
          return;
        }

        // 1) Story — prova /api/generate_story först, fallback till /generate_story
        let storyRes = await postJSON('/api/generate_story', payload);
        if (!storyRes.ok) {
          log('falling back to /generate_story');
          storyRes = await postJSON('/generate_story', payload);
        }
        const storyData = await storyRes.json().catch(() => ({}));
        if (!storyRes.ok || !storyData?.ok) {
          throw new Error(storyData?.error || `Serverfel (story): ${storyRes.status}`);
        }

        const story = storyData.story || '';
        if (!story) throw new Error('Tomt svar från generate_story.');
        setOut(story);
        setStatus('Skapar uppläsning…');

        // 2) TTS — prova /api/tts, fallback /tts
        let ttsRes = await postJSON('/api/tts', { text: story });
        if (!ttsRes.ok) {
          log('falling back to /tts');
          ttsRes = await postJSON('/tts', { text: story });
        }
        if (!ttsRes.ok) {
          let msg = `Serverfel (tts): ${ttsRes.status}`;
          try { const j = await ttsRes.json(); if (j?.error) msg = j.error; } catch {}
          throw new Error(msg);
        }
        await handleTTSResponse(ttsRes);
        setStatus('Klar!');
      } catch (e2) {
        err(e2);
        setOut(String(e2), true);
        setStatus('');
      } finally {
        if (btnCreate) {
          btnCreate.disabled = false;
          btnCreate.textContent = '✨ Skapa saga (med uppläsning)';
        }
      }
    });

    // ====== Spara/Rensa hjältar i localStorage ======
    function loadHeroes() {
      try { return JSON.parse(localStorage.getItem('bn_heroes') || '[]'); } catch { return []; }
    }
    function saveHeroes(list) {
      localStorage.setItem('bn_heroes', JSON.stringify(list));
    }

    btnSaveHero?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const h = (heroInput?.value || '').trim();
      if (!h) return;
      const list = loadHeroes();
      if (!list.includes(h)) {
        list.push(h);
        saveHeroes(list);
        setStatus(`Sparade hjälten “${h}”.`);
      }
    });

    btnReset?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      localStorage.setItem('bn_heroes', '[]');
      setStatus('Hjältar rensade.');
    });

    // ====== Tala in (stub – kraschar inte UI) ======
    btnSpeak?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setStatus('Mikrofon-inspelning (stub)…');
      setTimeout(() => setStatus(''), 1000);
    });

    // Små UX-resets
    ;['input','change'].forEach(evt => {
      [nameInput, ageInput, promptEl, heroInput].forEach(el => {
        el?.addEventListener(evt, () => setStatus(''));
      });
    });

    log('BN app.js ready');
  });
})();
