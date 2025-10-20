// public/app.js
(() => {
  const $ = s => document.querySelector(s);

  // fält/knappar
  const childName = $('#childName');
  const ageRange  = $('#ageRange');
  const prompt    = $('#prompt');
  const heroName  = $('#heroName');
  const useWhisper= $('#useWhisper');

  const btnSpeak  = $('#btnSpeak');
  const btnGenerate = $('#btnGenerate');
  const btnSaveHero = $('#btnSaveHero');
  const btnResetHeroes = $('#btnResetHeroes');

  const statusEl  = $('#status');
  const resultText= $('#resultText');
  const resultAudio = $('#resultAudio');

  // UI extra
  const ttsSpinner = $('#ttsSpinner');
  const cacheWrap  = $('#cacheWrap');
  const cacheBar   = $('#cacheBar');
  const cacheText  = $('#cacheText');
  const storyImagesWrap = $('#storyImages');

  let isBusy = false;
  const setBusy = (v, msg='') => {
    isBusy = v;
    [btnSpeak, btnGenerate, btnSaveHero, btnResetHeroes].forEach(b => b && (b.disabled = v));
    setStatus(msg);
  };
  const setStatus = (msg, type='') => {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (type ? ` status--${type}` : '');
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

  // ---- Story controls (ålders-styrning)
  const ageToControls = (age) => {
    switch (age) {
      case '1-2':  return { minWords: 50,  maxWords: 160,  tone:'bilderbok; enkel replik + [BYT SIDA] sparsamt', chapters:1 };
      case '3-4':  return { minWords: 120, maxWords: 280,  tone:'lekfull; tydlig början/mitten/slut', chapters:1 };
      case '5-6':  return { minWords: 250, maxWords: 450,  tone:'äventyr; hinder och lösning', chapters:1 };
      case '7-8':  return { minWords: 400, maxWords: 700,  tone:'mysterium/äventyr, cliffhanger', chapters:2 };
      case '9-10': return { minWords: 600, maxWords: 1000, tone:'fantasy/vänskap, moget språk', chapters:2 };
      case '11-12':return { minWords: 900, maxWords: 1600, tone:'spänning/rys; konsekvenser; nertonad moral', chapters:3 };
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

  // ==== GENERATE (story + TTS + images)
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

      // 3) Bilder (best effort)
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

  // ==== TAL-IN (Whisper) ====
  let mediaStream, mediaRecorder, chunks = [];
  let silenceTimer = null;
  const SILENCE_MS = 2200;         // auto-stop efter ~2.2s tystnad
  const SILENCE_LEVEL = 0.015;     // tröskel (0–1), kan fintrimmas

  btnSpeak?.addEventListener('click', async () => {
    if (btnSpeak.dataset.state === 'rec') {
      stopRecording();
    } else {
      await startRecording();
    }
  });

  async function startRecording() {
    try {
      const lang = (navigator.language || 'sv').toLowerCase().startsWith('sv') ? 'sv' : 'en';
      btnSpeak.textContent = 'Stoppa (auto)';
      btnSpeak.dataset.state = 'rec';
      setStatus('Lyssnar… prata nu');

      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm' });
      chunks = [];

      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(mediaStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);

      const data = new Uint8Array(analyser.fftSize);

      const checkSilence = () => {
        analyser.getByteTimeDomainData(data);
        // RMS-liknande
        let sum = 0;
        for (let i=0;i<data.length;i++) {
          const v = (data[i]-128)/128;
          sum += v*v;
        }
        const rms = Math.sqrt(sum / data.length);
        if (rms < SILENCE_LEVEL) {
          if (!silenceTimer) {
            silenceTimer = setTimeout(() => {
              silenceTimer = null;
              stopRecording();
            }, SILENCE_MS);
          }
        } else {
          if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
        }
        if (btnSpeak.dataset.state === 'rec') requestAnimationFrame(checkSilence);
      };
      requestAnimationFrame(checkSilence);

      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        await uploadForTranscription(blob);
        // stäng mic
        mediaStream.getTracks().forEach(t => t.stop());
        ctx.close();
      };

      mediaRecorder.start();
    } catch (err) {
      setStatus('Kunde inte starta mikrofon: ' + (err?.message || err), 'error');
      btnSpeak.textContent = 'Tala in';
      btnSpeak.dataset.state = '';
    }
  }

  function stopRecording() {
    try {
      btnSpeak.textContent = 'Tala in';
      btnSpeak.dataset.state = '';
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
      if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    } catch {}
  }

  async function uploadForTranscription(blob) {
    try {
      setStatus('Transkriberar…');
      const fd = new FormData();
      fd.append('file', blob, 'inspelning.webm');
      fd.append('language', 'sv');

      const res = await fetch('/api/whisper', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`Whisper ${res.status} ${await res.text().catch(()=> '')}`);
      const j = await res.json();
      const txt = (j?.text || '').trim();
      if (txt) {
        // fyll i sagognistan + aktivera checkbox
        if (prompt) prompt.value = txt;
        if (useWhisper) useWhisper.checked = true;
        setStatus('Klart! Text från tal inläst.', 'ok');
      } else {
        setStatus('Ingen text hittad i inspelningen.', 'error');
      }
    } catch (err) {
      setStatus('Kunde inte transkribera: ' + (err?.message || err), 'error');
    }
  }

  // ==== Hjältar (lokal-minne)
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

  setStatus('');
})();
