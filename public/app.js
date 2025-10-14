(() => {
  // ----- Hjälpare för DOM -----
  const $ = (sel) => document.querySelector(sel);

  // Fält
  const childName = $('#childName');
  const ageRange  = $('#ageRange');
  const prompt    = $('#prompt');
  const heroName  = $('#heroName');
  const useWhisper= $('#useWhisper');

  // Knappar
  const btnSpeak        = $('#btnSpeak');
  const btnGenerate     = $('#btnGenerate');
  const btnSaveHero     = $('#btnSaveHero');
  const btnResetHeroes  = $('#btnResetHeroes');

  // UI
  const statusEl    = $('#status');
  const resultText  = $('#resultText');
  const resultAudio = $('#resultAudio');

  // Spinner + cache-mätare
  const ttsSpinner = $('#ttsSpinner');   // <div id="ttsSpinner" hidden>…</div>
  const cacheWrap  = $('#cacheWrap');    // container (hidden som default)
  const cacheBar   = $('#cacheBar');     // inner bar
  const cacheText  = $('#cacheText');    // textex. "Återanvänt från minnet: 73%"

  // Bildcontainer (kan saknas, då hoppar vi över)
  const storyImagesWrap = $('#storyImages');

  // ----- Status/Busy -----
  let isBusy = false;
  const setBusy = (v, msg = '') => {
    isBusy = v;
    [btnSpeak, btnGenerate, btnSaveHero, btnResetHeroes].forEach(b => b && (b.disabled = v));
    setStatus(msg);
  };

  const setStatus = (msg, type = '') => {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.remove('status--ok','status--error');
    if (type) statusEl.classList.add(`status--${type}`);
  };

  const showSpinner = (show) => { if (ttsSpinner) ttsSpinner.hidden = !show; };

  const updateCacheMeter = (hits, total) => {
    if (!cacheWrap || !cacheBar || !cacheText) return;
    const ratio = total > 0 ? Math.max(0, Math.min(1, hits/total)) : 0;
    const pct   = Math.round(ratio * 100);
    cacheBar.style.width = `${pct}%`;
    cacheText.textContent = `Återanvänt från minnet: ${pct}%`;
    cacheWrap.hidden = false;
  };

  const renderStoryImages = (images) => {
    if (!storyImagesWrap) return;
    storyImagesWrap.innerHTML = '';
    (images || []).forEach(img => {
      const card = document.createElement('div');
      card.className = 'story-image-card';
      card.innerHTML = `<img src="${img.url}" alt="${(img.tags||[]).slice(0,3).join(', ')}" />`;
      storyImagesWrap.appendChild(card);
    });
  };

  // ----- Lokal “hjältar”-lista -----
  const heroKey = 'bn_heroes_v1';
  const loadHeroes = () => { try { return JSON.parse(localStorage.getItem(heroKey) || '[]'); } catch { return []; } };
  const saveHeroes = (list) => localStorage.setItem(heroKey, JSON.stringify(list.slice(0, 50)));

  // ----- Åldersstyrda kontroller -----
  const ageToControls = (age) => {
    switch (age) {
      case '1-2':  return { minWords: 30,  maxWords: 80,  tone:'bilderbok; färger, bondgård, djur, traktorer, ljud & upprepningar', chapters:1, pauseMs: 600 };
      case '3-4':  return { minWords: 120, maxWords: 280,  tone:'enkel handling, tydlig början/slut; humor & igenkänning', chapters:1, pauseMs: 500 };
      case '5-6':  return { minWords: 250, maxWords: 450,  tone:'lite mer komplex; problem som löses; korta kapitel',     chapters:1, pauseMs: 450 };
      case '7-8':  return { minWords: 400, maxWords: 700,  tone:'äventyr/mysterier; humor; cliffhangers',                chapters:2, pauseMs: 400 };
      case '9-10': return { minWords: 600, maxWords: 1000, tone:'fantasy/vänskap/moral; kort kapitelbok',                chapters:2, pauseMs: 350 };
      case '11-12':return { minWords: 900, maxWords: 1600, tone:'djupare teman; karaktärsutveckling; kapitel',           chapters:3, pauseMs: 300 };
      default:     return { minWords: 250, maxWords: 500,  tone:'barnvänlig',                                            chapters:1, pauseMs: 400 };
    }
  };

  const buildStoryPayload = () => {
    const age = (ageRange?.value || '').trim();
    return {
      childName: (childName?.value || '').trim(),
      heroName:  (heroName?.value  || '').trim(),
      ageRange:  age,
      prompt:    (prompt?.value    || '').trim(),
      controls:  ageToControls(age),
      read_aloud: true
    };
  };

  // ====== GENERATE (story + TTS + images) ======
  btnGenerate?.addEventListener('click', async () => {
    if (isBusy) return;

    const payload = buildStoryPayload();
    if (!payload.prompt && !useWhisper?.checked) {
      setStatus('Skriv något i sagognistan eller tala in.', 'error');
      return;
    }

    // Nollställ UI
    resultText.textContent = '';
    if (resultAudio) {
      resultAudio.hidden = true;
      resultAudio.removeAttribute('src');
    }
    if (cacheWrap) cacheWrap.hidden = true;
    showSpinner(false);
    if (storyImagesWrap) storyImagesWrap.innerHTML = '';

    try {
      setBusy(true, 'Skapar saga…');

      // 1) Story
      const resStory = await fetch('/api/generate_story', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      });

      if (!resStory.ok) {
        const t = await resStory.text().catch(()=> '');
        throw new Error(`Story: ${resStory.status} ${t}`);
      }

      const data = await resStory.json();
      const story = (data && data.story) ? data.story : '';
      if (!story) throw new Error('Tomt svar från /api/generate_story.');
      resultText.textContent = story;

      // 2) TTS
      setStatus('Skapar uppläsning…');
      showSpinner(true);

      const resTTS = await fetch('/tts', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          text: story,
          // valfritt: voiceId: 'din_elevenlabs_röst'
          // valfritt: pauseMs: payload.controls.pauseMs
        })
      });

      // 405 kan fortfarande komma om någon gammal deploy ligger kvar – men vi visar ändå storyn
      if (!resTTS.ok) {
        const t = await resTTS.text().catch(()=> '');
        console.warn('TTS fail:', resTTS.status, t);
      } else {
        // cache-headrar från backend
        const hits  = parseInt(resTTS.headers.get('x-tts-hits')  || '0', 10);
        const total = parseInt(resTTS.headers.get('x-tts-total') || '0', 10);
        if (!Number.isNaN(total)) updateCacheMeter(hits, total);

        const blob = await resTTS.blob();
        const url  = URL.createObjectURL(blob);
        if (resultAudio) {
          resultAudio.src = url;
          resultAudio.hidden = false;
          // autospel efter 0.3s så stream hunnit buffras
          setTimeout(() => resultAudio.play().catch(()=>{}), 300);
        }
      }

      // 3) Bilder (tyst fel)
      try {
        const imgRes = await fetch('/api/images', {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ storyText: story, ageRange: payload.ageRange, count: 3 })
        });
        if (imgRes.ok) {
          const j = await imgRes.json().catch(()=> null);
          if (j?.images) renderStoryImages(j.images);
        }
      } catch (e) {
        console.debug('images skipped:', e?.message || e);
      }

      showSpinner(false);
      setBusy(false, 'Klar!', 'ok');
    } catch (err) {
      showSpinner(false);
      setBusy(false, '');
      setStatus('Kunde inte skapa sagan: ' + (err?.message || err), 'error');
    }
  });

  // ====== TALA IN (Whisper) ======
  // Enkel MediaRecorder -> POST /api/whisper_transcribe (Content-Type: audio/webm)
  let mediaRecorder, chunks = [];
  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    mediaRecorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      try {
        setBusy(true, 'Transkriberar…');
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const res = await fetch('/api/whisper_transcribe', {
          method: 'POST',
          headers: { 'Content-Type':'audio/webm' },
          body: blob
        });
        if (!res.ok) throw new Error(`Whisper ${res.status}`);
        const j = await res.json().catch(()=> ({}));
        const text = (j && j.text) ? j.text.trim() : '';
        if (text) prompt.value = text;
        setBusy(false, 'Klart!', 'ok');
      } catch (e) {
        setBusy(false, '');
        setStatus('Kunde inte transkribera: ' + (e?.message || e), 'error');
      }
    };
    mediaRecorder.start();
    btnSpeak?.classList.add('is-recording');
    setStatus('Spelar in… tryck ”Tala in” igen för att stoppa.');
  };
  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    btnSpeak?.classList.remove('is-recording');
  };

  btnSpeak?.addEventListener('click', async () => {
    try {
      if (btnSpeak.classList.contains('is-recording')) {
        stopRecording();
      } else {
        await startRecording();
      }
    } catch (e) {
      setStatus('Mikrofon fel: ' + (e?.message || e), 'error');
    }
  });

  // ====== Hjältar ======
  btnSaveHero?.addEventListener('click', () => {
    const h = (heroName?.value || '').trim();
    if (!h) { setStatus('Skriv ett hjältenamn först.', 'error'); return; }
    const list = loadHeroes();
    if (!list.includes(h)) list.unshift(h);
    saveHeroes(list);
    setStatus(`Sparade hjälten: ${h}`, 'ok');
  });

  btnResetHeroes?.addEventListener('click', () => {
    saveHeroes([]);
    setStatus('Rensade sparade hjältar.', 'ok');
  });

  // Init
  setStatus('');
})();
