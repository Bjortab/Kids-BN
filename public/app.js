(() => {
  const $ = (s) => document.querySelector(s);

  // Fält
  const childName = $('#childName');
  const ageRange  = $('#ageRange');
  const prompt    = $('#prompt');
  const heroName  = $('#heroName');
  const useWhisper= $('#useWhisper');
  const voiceIdEl = $('#voiceId');

  // Knappar
  const btnSpeak      = $('#btnSpeak');
  const btnGenerate   = $('#btnGenerate');
  const btnSaveHero   = $('#btnSaveHero');
  const btnResetHeroes= $('#btnResetHeroes');

  // UI
  const statusEl   = $('#status');
  const resultText = $('#resultText');
  const resultAudio= $('#resultAudio');

  const ttsSpinner = $('#ttsSpinner');
  const spinnerText= $('#spinnerText');

  const cacheWrap  = $('#cacheWrap');
  const cacheBar   = $('#cacheBar');
  const cacheText  = $('#cacheText');

  const storyImagesWrap = $('#storyImages');
  const recBadge = $('#recBadge');

  // ====== Hjälp ======
  let isBusy = false;
  const setBusy = (v, msg='') => {
    isBusy = v;
    [btnSpeak, btnGenerate, btnSaveHero, btnResetHeroes].forEach(b => b && (b.disabled = v));
    setStatus(msg);
  };
  const setStatus = (msg, type='') => {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.remove('status--ok','status--error');
    if (type) statusEl.classList.add(`status--${type}`);
  };
  function showSpinner(show, txt){
    if (!ttsSpinner) return;
    ttsSpinner.hidden = !show;
    if (typeof txt === 'string') spinnerText.textContent = txt;
  }
  function updateCacheMeter(flag){
    cacheWrap.style.display = 'flex';
    if (flag === 'HIT') {
      cacheBar.style.width = '100%';
      cacheBar.style.background = '#2fff9e';
      cacheText.textContent = 'Cache: Återanvänd (HIT)';
    } else if (flag === 'MISS') {
      cacheBar.style.width = '20%';
      cacheBar.style.background = '#ff6969';
      cacheText.textContent = 'Cache: Ny generering (MISS)';
    } else {
      cacheBar.style.width = '0%';
      cacheText.textContent = 'Cache: –';
    }
  }
  function renderStoryImages(images){
    storyImagesWrap.innerHTML = '';
    (images || []).forEach(img => {
      const card = document.createElement('div');
      card.className = 'story-image-card';
      card.innerHTML = `<img src="${img.url}" alt="${(img.tags||[]).slice(0,2).join(', ')}" />`;
      storyImagesWrap.appendChild(card);
    });
  }

  // ====== Ålderskontroller ======
  const ageToControls = (age) => {
    switch (age) {
      case '1–2 år':  return { minWords: 50,  maxWords: 160,  tone:'bilderbok, rim, färger, ljud och upprepningar', chapters:1 };
      case '3–4 år':  return { minWords: 120, maxWords: 280,  tone:'enkel handling med tydlig början och slut; humor och igenkänning', chapters:1 };
      case '5–6 år':  return { minWords: 250, maxWords: 450,  tone:'lite mer komplexa berättelser med problem som löses; korta kapitel', chapters:1 };
      case '7–8 år':  return { minWords: 400, maxWords: 700,  tone:'äventyr och mysterier, humor; introducera serier och cliffhangers', chapters:2 };
      case '9–10 år': return { minWords: 600, maxWords: 1000, tone:'fantasy/vänskap/moralfrågor; kapitelberättelse, 2–3 sidor', chapters:2 };
      case '11–12 år':return { minWords: 900, maxWords: 1600, tone:'djupare teman och karaktärsutveckling; kapitel', chapters:3 };
      default:        return { minWords: 250, maxWords: 500,  tone:'barnvänlig', chapters:1 };
    }
  };

  const buildStoryPayload = () => {
    const age = ageRange.value;
    return {
      childName: (childName.value || '').trim(),
      heroName:  (heroName.value || '').trim(),
      ageRange:  age,
      prompt:    (prompt.value || '').trim(),
      controls:  ageToControls(age)
    };
  };

  // ====== GENERERA SAGA + TTS + BILDER ======
  btnGenerate?.addEventListener('click', async () => {
    if (isBusy) return;

    const payload = buildStoryPayload();
    if (!payload.prompt && !useWhisper?.checked) {
      setStatus('Skriv något i sagognistan eller tala in.', 'error');
      return;
    }

    resultText.textContent = '';
    resultAudio.hidden = true;
    resultAudio.removeAttribute('src');
    cacheWrap.style.display = 'none';
    storyImagesWrap.innerHTML = '';

    try {
      setBusy(true, 'Skapar saga…');
      showSpinner(true, 'Skapar saga…');

      // 1) Story
      const resStory = await fetch('/api/generate_story', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ ...payload, read_aloud:true })
      });
      if (!resStory.ok) throw new Error(`Story: ${resStory.status} ${await resStory.text().catch(()=> '')}`);
      const data = await resStory.json();
      if (data.story) resultText.textContent = data.story;

      // 2) TTS (skicka ev. voiceId)
      setStatus('Skapar uppläsning…');
      showSpinner(true, 'Skapar uppläsning…');

      const chosenVoiceId = (voiceIdEl?.value || '').trim();
      const resTTS = await fetch('/tts', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ text: data.story, voiceId: chosenVoiceId })
      });
      if (!resTTS.ok) throw new Error(`TTS: ${resTTS.status} ${await resTTS.text().catch(()=> '')}`);

      updateCacheMeter(resTTS.headers.get('x-tts-cache') || '');

      const blob = await resTTS.blob();
      const url = URL.createObjectURL(blob);
      resultAudio.src = url;
      resultAudio.hidden = false;

      // 3) Bilder (om backenden stöder /api/images)
      try {
        const imgRes = await fetch('/api/images', {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ storyText: data.story, ageRange: payload.ageRange, count: 3 })
        });
        if (imgRes.ok) {
          const j = await imgRes.json();
          if (j?.images) renderStoryImages(j.images);
        }
      } catch {}

      showSpinner(false);
      setBusy(false, 'Klar!', 'ok');
      resultAudio.play().catch(()=>{});
    } catch (err) {
      showSpinner(false);
      setBusy(false, '');
      setStatus('Kunde inte skapa sagan: ' + (err?.message || err), 'error');
    }
  });

  // ====== Hjältar (lokalt minne) ======
  const heroKey = 'bn_heroes_v1';
  const loadHeroes = () => { try { return JSON.parse(localStorage.getItem(heroKey) || '[]'); } catch { return []; } };
  const saveHeroes = (list) => localStorage.setItem(heroKey, JSON.stringify(list.slice(0, 50)));

  btnSaveHero?.addEventListener('click', () => {
    const h = (heroName.value || '').trim();
    if (!h){ setStatus('Skriv ett hjältenamn först.', 'error'); return; }
    const list = loadHeroes();
    if (!list.includes(h)) list.unshift(h);
    saveHeroes(list);
    setStatus(`Sparade hjälten: ${h}`, 'ok');
  });
  btnResetHeroes?.addEventListener('click', () => {
    saveHeroes([]);
    setStatus('Rensade sparade hjältar.', 'ok');
  });

  // ====== TALA IN (Whisper-transcribe endpoint du redan har) ======
  let mediaRec = null, audioChunks = [], audioCtx = null, analyser = null, silenceTimer = null;
  let recording = false;

  btnSpeak?.addEventListener('click', async () => {
    if (recording) {
      stopRecording();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
      mediaRec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      audioChunks = [];
      recording = true;
      recBadge.style.display = 'inline';

      // Tystnad => auto-stop
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      watchSilence();

      mediaRec.ondataavailable = (e) => { if (e.data.size) audioChunks.push(e.data); };
      mediaRec.onstop = async () => {
        try {
          const blob = new Blob(audioChunks, { type: 'audio/webm' });
          const form = new FormData();
          form.append('audio', blob, 'speech.webm');

          showSpinner(true, 'Transkriberar tal…');
          // OBS: Anropa din befintliga endpoint (utan /api/ prefix om din installation så kräver)
          const res = await fetch('/whisper_transcribe', { method:'POST', body: form });
          showSpinner(false);

          if (!res.ok) {
            setStatus(`Kunde inte transkribera: Whisper ${res.status}`, 'error');
            return;
          }
          const j = await res.json();
          if (j?.text) {
            prompt.value = (prompt.value ? (prompt.value.trim() + ' ') : '') + j.text;
            setStatus('Talet omvandlat → sagognista uppdaterad.', 'ok');
          } else {
            setStatus('Tomt svar från transkribering.', 'error');
          }
        } catch (e) {
          setStatus('Fel vid transkribering: ' + (e?.message || e), 'error');
        } finally {
          recBadge.style.display = 'none';
        }
      };

      mediaRec.start(250);
      setStatus('Spelar in… prata normalt. (Tystnad stoppar inspelningen automatiskt.)', 'ok');
    } catch (e) {
      setStatus('Mikrofonfel: ' + (e?.message || e), 'error');
    }
  });

  function stopRecording() {
    if (!recording) return;
    recording = false;
    try { mediaRec && mediaRec.state !== 'inactive' && mediaRec.stop(); } catch {}
    try { audioCtx && audioCtx.close(); } catch {}
    try {
      const tracks = mediaRec?.stream?.getTracks?.() || [];
      tracks.forEach(t => t.stop());
    } catch {}
    clearTimeout(silenceTimer);
    recBadge.style.display = 'none';
  }

  function watchSilence() {
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!recording) return;
      analyser.getByteTimeDomainData(data);
      let max = 0;
      for (let i=0;i<data.length;i++) {
        const v = Math.abs(data[i]-128);
        if (v>max) max = v;
      }
      const speaking = max > 8; // tröskel
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        if (!speaking) stopRecording();
        else watchSilence();
      }, 1400);
      if (speaking) watchSilence();
    };
    tick();
  }

  setStatus('');
})();
