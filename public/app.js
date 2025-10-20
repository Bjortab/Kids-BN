// public/app.js
(() => {
  const $ = s => document.querySelector(s);

  // Inputs
  const childName = $('#childName');
  const ageRange  = $('#ageRange');
  const prompt    = $('#prompt');
  const heroName  = $('#heroName');
  const useWhisper= $('#useWhisper');

  // Buttons
  const btnSpeak  = $('#btnSpeak');
  const btnGenerate = $('#btnGenerate');
  const btnSaveHero = $('#btnSaveHero');
  const btnResetHeroes = $('#btnResetHeroes');

  // Status / result
  const statusEl  = $('#status');
  const resultText= $('#resultText');
  const resultAudio = $('#resultAudio');

  // UI extra
  const ttsSpinner = $('#ttsSpinner');
  const cacheWrap  = $('#cacheWrap');
  const cacheBar   = $('#cacheBar');
  const cacheText  = $('#cacheText');
  const storyImagesWrap = $('#storyImages');

  // ===== Status helpers =====
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
  function showSpinner(show){ if(ttsSpinner) ttsSpinner.hidden = !show; }
  function updateCacheMeter(hits, total){
    if (!cacheWrap || !cacheBar || !cacheText) return;
    const ratio = total>0 ? Math.max(0, Math.min(1, hits/total)) : 0;
    const pct = Math.round(ratio*100);
    cacheBar.style.width = `${pct}%`;
    cacheText.textContent = `Återanvänt från minnet: ${pct}%`;
    cacheWrap.hidden = false;
  }
  function renderStoryImages(images){
    if (!storyImagesWrap) return;
    storyImagesWrap.innerHTML = '';
    (images || []).forEach(img => {
      const card = document.createElement('div');
      card.className = 'story-image-card';
      card.innerHTML = `<img src="${img.url}" alt="${(img.tags||[]).slice(0,2).join(', ')}" />`;
      storyImagesWrap.appendChild(card);
    });
  }

  // ===== Age → controls
  const ageToControls = (age) => {
    switch (age) {
      case '1-2':  return { minWords: 50,  maxWords: 160,  tone:'bilderbok; rim; ljud; upprepning; [BYT SIDA] sparsamt', chapters:1 };
      case '3-4':  return { minWords: 120, maxWords: 280,  tone:'enkel handling; humor; igenkänning', chapters:1 };
      case '5-6':  return { minWords: 250, maxWords: 450,  tone:'problem → lösning; korta kapitel', chapters:1 };
      case '7-8':  return { minWords: 400, maxWords: 700,  tone:'äventyr/mysterier; antydd cliffhanger', chapters:2 };
      case '9-10': return { minWords: 600, maxWords: 1000, tone:'fantasy/vänskap/moral; kapitel', chapters:2 };
      case '11-12':return { minWords: 900, maxWords: 1600, tone:'mognare teman; stakes; payoff; kapitel', chapters:3 };
      default:     return { minWords: 250, maxWords: 500,  tone:'barnvänlig', chapters:1 };
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

  // ===== Generate: story -> TTS -> images
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
    cacheWrap.hidden = true;
    showSpinner(false);
    if (storyImagesWrap) storyImagesWrap.innerHTML = '';

    try {
      setBusy(true, 'Skapar saga…');

      // 1) Story
      const resStory = await fetch('/api/generate_story', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ ...payload, read_aloud:true })
      });
      if (!resStory.ok) throw new Error(`Story: ${resStory.status} ${await resStory.text().catch(()=> '')}`);
      const data = await resStory.json();
      if (data.story) resultText.textContent = data.story;

      // 2) TTS
      setStatus('Skapar uppläsning…');
      showSpinner(true);
      const resTTS = await fetch('/tts', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ text: data.story })
      });
      if (!resTTS.ok) throw new Error(`TTS: ${resTTS.status} ${await resTTS.text().catch(()=> '')}`);
      const hits  = parseInt(resTTS.headers.get('x-tts-hits')  || '0', 10);
      const total = parseInt(resTTS.headers.get('x-tts-total') || '0', 10);
      if (!Number.isNaN(total)) updateCacheMeter(hits, total);

      const blob = await resTTS.blob();
      const url = URL.createObjectURL(blob);
      resultAudio.src = url;
      resultAudio.hidden = false;

      // 3) Bilder (valfritt)
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

  // ===== Hjältar (lokalt minne)
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

  // ===== TALA IN -> /api/whisper_transcribe (auto-stop vid tystnad)
  let mediaStream, mediaRecorder, chunks = [];
  let analyser, audioCtx, sourceNode, silenceTimer = null;
  const SILENCE_MS = 2000;
  const SILENCE_LEVEL = 0.02;

  btnSpeak?.addEventListener('click', async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      stopRecording();
      return;
    }
    try { await startRecording(); } catch(e){ setStatus('Mikrofonfel: '+(e?.message||e), 'error'); }
  });

  async function startRecording() {
    setStatus('Lyssnar… (tystnad stoppar automatiskt)');
    chunks = [];
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio:true });
    mediaRecorder = new MediaRecorder(mediaStream, { mimeType:'audio/webm' });

    // VAD
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode = audioCtx.createMediaStreamSource(mediaStream);
    analyser = audioCtx.createAnalyser(); analyser.fftSize = 2048;
    sourceNode.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);
    const loop = () => {
      analyser.getByteTimeDomainData(data);
      let sum=0; for (let i=0;i<data.length;i++){ const v=(data[i]-128)/128; sum+=v*v; }
      const rms = Math.sqrt(sum/data.length);
      const silent = rms < SILENCE_LEVEL;
      if (silent){
        if (!silenceTimer){
          silenceTimer = setTimeout(() => { stopRecording(); }, SILENCE_MS);
        }
      } else if (silenceTimer){
        clearTimeout(silenceTimer); silenceTimer=null;
      }
      if (mediaRecorder && mediaRecorder.state === 'recording') requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    mediaRecorder.ondataavailable = e => e.data.size && chunks.push(e.data);
    mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type:'audio/webm' });
        await sendToWhisper(blob);
      } finally {
        cleanupAudio();
      }
    };
    mediaRecorder.start();
    btnSpeak.textContent = 'Stoppa';
  }
  function stopRecording(){
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (mediaStream) mediaStream.getTracks().forEach(t=>t.stop());
    btnSpeak.textContent = 'Tala in';
  }
  function cleanupAudio(){
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
    try{ sourceNode && sourceNode.disconnect(); }catch{}
    try{ analyser && analyser.disconnect(); }catch{}
    try{ audioCtx && audioCtx.close(); }catch{}
    sourceNode = analyser = audioCtx = null;
  }
  async function sendToWhisper(blob){
    try{
      setStatus('Transkriberar…');
      const res = await fetch('/api/whisper_transcribe', {
        method: 'POST',
        headers: { 'Content-Type':'audio/webm' },
        body: blob
      });
      if (!res.ok) {
        const t = await res.text().catch(()=> '');
        setStatus(`Whisper fel: ${res.status}`, 'error');
        console.error('Whisper', t);
        return;
      }
      const j = await res.json();
      if (j?.ok && j.text){
        const prev = (prompt.value||'').trim();
        prompt.value = prev ? (prev + ' ' + j.text) : j.text;
        if (useWhisper) useWhisper.checked = true;
        setStatus('Klart! Texten är inläst.', 'ok');
      } else {
        setStatus('Ingen text hittad.', 'error');
      }
    }catch(e){
      setStatus('Fel vid transkribering: ' + (e?.message||e), 'error');
    }
  }

  setStatus('');
})();
