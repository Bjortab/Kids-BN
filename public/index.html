(() => {
  // ===== DOM helpers =====
  const $ = sel => document.querySelector(sel);

  // Inputs
  const childName   = $('#childName');
  const ageRange    = $('#ageRange');
  const prompt      = $('#prompt');
  const heroName    = $('#heroName');
  const useWhisper  = $('#useWhisper');

  // Buttons
  const btnSpeak      = $('#btnSpeak');
  const btnGenerate   = $('#btnGenerate');
  const btnSaveHero   = $('#btnSaveHero');
  const btnResetHeroes= $('#btnResetHeroes');

  // Status / results
  const statusEl    = $('#status');
  const resultText  = $('#resultText');
  const resultAudio = $('#resultAudio');

  // UI: spinner + cache-meter + bilder
  const ttsSpinner  = $('#ttsSpinner');
  const cacheWrap   = $('#cacheWrap');
  const cacheBar    = $('#cacheBar');
  const cacheText   = $('#cacheText');
  const storyImagesWrap = $('#storyImages');

  // ===== State guard =====
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

  // Small helpers
  const showSpinner = (show) => { if (ttsSpinner) ttsSpinner.hidden = !show; };
  const updateCacheMeter = (hits, total) => {
    if (!cacheWrap || !cacheBar || !cacheText) return;
    const ratio = total > 0 ? Math.max(0, Math.min(1, hits / total)) : 0;
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
      card.innerHTML = `<img src="${img.url}" alt="${(img.tags||[]).slice(0,2).join(', ')}" />`;
      storyImagesWrap.appendChild(card);
    });
  };

  // ===== Local storage: heroes =====
  const heroKey = 'bn_heroes_v1';
  const loadHeroes = () => { try { return JSON.parse(localStorage.getItem(heroKey) || '[]'); } catch { return []; } };
  const saveHeroes = (list) => localStorage.setItem(heroKey, JSON.stringify(list.slice(0, 50)));

  // ===== Age controls (låst logik) =====
  const ageToControls = (age) => {
    switch (age) {
      case '1-2':  return { minWords: 50,  maxWords: 160,  tone:'bilderbok; rim; upprepning; enkla ord', chapters:1 };
      case '3-4':  return { minWords: 120, maxWords: 280,  tone:'enkel dramaturgi; humor; tydlig början/slut', chapters:1 };
      case '5-6':  return { minWords: 250, maxWords: 450,  tone:'lite mer komplex; problem som löses; korta kapitel', chapters:1 };
      case '7-8':  return { minWords: 400, maxWords: 700,  tone:'äventyr/mysterium; action; små cliffhangers', chapters:2 };
      case '9-10': return { minWords: 600, maxWords: 1000, tone:'kapitel; moraliska val; tempo; mindre “mys”', chapters:2 };
      case '11-12':return { minWords: 900, maxWords: 1600, tone:'tydlig dramatisk båge; stakes; konsekvenser', chapters:3 };
      default:     return { minWords: 250, maxWords: 500,  tone:'barnvänlig', chapters:1 };
    }
  };
  const buildStoryPayload = () => {
    const age = ageRange?.value || '';
    return {
      childName: (childName?.value || '').trim(),
      heroName:  (heroName?.value  || '').trim(),
      ageRange:  age,
      prompt:    (prompt?.value    || '').trim(),
      controls:  ageToControls(age)
    };
  };

  // ====== Generate (story + TTS + images) ======
  btnGenerate?.addEventListener('click', async () => {
    if (isBusy) return;
    const payload = buildStoryPayload();
    if (!payload.prompt && !useWhisper?.checked) {
      setStatus('Skriv något i sagognistan eller tala in.', 'error');
      return;
    }

    // reset UI
    resultText.textContent = '';
    resultAudio.hidden = true;
    resultAudio.removeAttribute('src');
    cacheWrap && (cacheWrap.hidden = true);
    showSpinner(false);
    storyImagesWrap && (storyImagesWrap.innerHTML = '');

    try {
      setBusy(true, 'Skapar saga…');

      // 1) Story
      const resStory = await fetch('/api/generate_story', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ ...payload, read_aloud:true })
      });
      if (!resStory.ok) throw new Error(`Story: ${resStory.status} ${await resStory.text().catch(()=> '')}`);
      const storyData = await resStory.json();
      if (storyData.story) resultText.textContent = storyData.story;

      // 2) TTS
      setStatus('Skapar uppläsning…');
      showSpinner(true);
      const resTTS = await fetch('/tts', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ text: storyData.story, voiceId: '' }) // voiceId sätts i backend om tom
      });
      if (!resTTS.ok) throw new Error(`TTS: ${resTTS.status} ${await resTTS.text().catch(()=> '')}`);

      const hits  = parseInt(resTTS.headers.get('x-tts-hits')  || '0', 10);
      const total = parseInt(resTTS.headers.get('x-tts-total') || '0', 10);
      if (!Number.isNaN(total)) updateCacheMeter(hits, total);

      const blob = await resTTS.blob();
      const url  = URL.createObjectURL(blob);
      resultAudio.src = url;
      resultAudio.hidden = false;

      // 3) Bilder (best-effort)
      try {
        const imgRes = await fetch('/api/images', {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ storyText: storyData.story, ageRange: payload.ageRange, count: 3 })
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

  // ===== Hjälte-hantering =====
  btnSaveHero?.addEventListener('click', () => {
    const h = (heroName?.value || '').trim();
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

  // ===== Recording -> Whisper (auto-stop vid tystnad) =====
  let mediaRecorder, mediaStream, chunks = [];
  let audioCtx, analyser, dataArray, silenceTimer, meterInterval;

  const VAD_SILENCE_MS = 3000;      // auto-stop efter 3 s tystnad
  const VAD_POLL_MS    = 200;       // provtagningsintervall
  const VAD_DB_THRESH  = -50;       // dB-tröskel (justera vid behov)

  function levelDb() {
    if (!analyser) return -90;
    analyser.getByteTimeDomainData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const v = (dataArray[i] - 128) / 128; // -1..1
      sum += v * v;
    }
    const rms = Math.sqrt(sum / dataArray.length) || 1e-8;
    return 20 * Math.log10(rms);
  }

  async function startRecording() {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];

    mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm' });
    mediaRecorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        await sendToWhisper(blob);
      } catch (err) {
        setStatus('Kunde inte transkribera: ' + (err?.message || err), 'error');
      } finally {
        cleanupAudio();
      }
    };
    mediaRecorder.start();

    // VAD
    audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
    const src  = audioCtx.createMediaStreamSource(mediaStream);
    analyser   = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    dataArray  = new Uint8Array(analyser.fftSize);
    src.connect(analyser);

    let silentSince = null;

    setStatus('Spelar in… (tystnad stoppar automatiskt)');
    btnSpeak?.classList.add('is-recording');

    meterInterval = setInterval(() => {
      const db = levelDb();
      const now = Date.now();
      const isSilent = db < VAD_DB_THRESH;

      if (isSilent) {
        if (!silentSince) silentSince = now;
        if (now - silentSince >= VAD_SILENCE_MS) stopRecording('auto');
      } else {
        silentSince = null;
      }
    }, VAD_POLL_MS);
  }

  function stopRecording(reason = 'manual') {
    try {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
    } finally {
      btnSpeak?.classList.remove('is-recording');
      if (reason === 'auto') setStatus('Tystnad uppfattad – stoppar inspelning…');
      else setStatus('Stoppar inspelning…');
    }
  }

  function cleanupAudio() {
    if (meterInterval) { clearInterval(meterInterval); meterInterval = null; }
    if (audioCtx && audioCtx.state !== 'closed') { audioCtx.close().catch(()=>{}); }
    audioCtx = analyser = null;
    dataArray = null;
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
  }

  async function sendToWhisper(blob) {
    setBusy(true, 'Skickar ljud till Whisper…');
    const res = await fetch('/api/whisper_transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm' },
      body: blob
    });

    if (!res.ok) {
      const txt = await res.text().catch(()=>'');
      setBusy(false);
      throw new Error(`Whisper svarade inte: ${res.status} ${txt}`);
    }

    const data = await res.json();
    prompt.value = (data.text || '').trim();
    setBusy(false, 'Lokal inspelning klar.');
  }

  // Toggle-knapp
  btnSpeak?.addEventListener('click', async () => {
    try {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopRecording('manual');
        return;
      }
      await startRecording();
    } catch (err) {
      cleanupAudio();
      setStatus('Mikrofon fel: ' + (err?.message || err), 'error');
    }
  });

  // Init
  setStatus('');
})();
