(() => {
  // ===== DOM =====
  const $ = sel => document.querySelector(sel);
  const childName       = $('#childName');
  const ageRange        = $('#ageRange');
  const promptEl        = $('#prompt');
  const heroName        = $('#heroName');
  const btnSpeak        = $('#btnSpeak');
  const btnGenerate     = $('#btnGenerate');
  const btnSaveHero     = $('#btnSaveHero');
  const btnResetHeroes  = $('#btnResetHeroes');
  const statusEl        = $('#status');
  const resultText      = $('#resultText');
  const resultAudio     = $('#resultAudio');

  // ===== Status / spinner / låsning =====
  let isBusy = false;
  const buttons = [btnSpeak, btnGenerate, btnSaveHero, btnResetHeroes];

  const setBusy = (v) => { isBusy = v; buttons.forEach(b => b && (b.disabled = v)); };
  const setStatus = (msg, type = '') => {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.remove('status--ok', 'status--error');
    if (type) statusEl.classList.add(`status--${type}`);
  };

  let spinner, spinnerMsg;
  function ensureSpinner() {
    if (spinner) return;
    spinner = document.createElement('div');
    spinner.className = 'bn-spinner';
    spinner.innerHTML = `
      <div class="bn-spinner__box">
        <div class="bn-spinner__dot"></div>
        <div class="bn-spinner__dot"></div>
        <div class="bn-spinner__dot"></div>
        <div class="bn-spinner__msg" id="bnSpinnerMsg"></div>
      </div>`;
    document.body.appendChild(spinner);
    spinnerMsg = document.getElementById('bnSpinnerMsg');
  }
  function showSpinner(msg='') { ensureSpinner(); spinnerMsg.textContent = msg; spinner.classList.add('is-visible'); }
  function hideSpinner() { if (spinner) spinner.classList.remove('is-visible'); }

  // ===== Ålderskontroller → längd & ton =====
  const ageToControls = (age) => {
    switch (age) {
      case '1-2':  return { minWords: 50,  maxWords: 160,  tone:'bilderbok, rim, färger, ljud och upprepningar', chapters:1 };
      case '3-4':  return { minWords: 120, maxWords: 280,  tone:'enkel handling med tydlig början/slut; humor/igenkänning', chapters:1 };
      case '5-6':  return { minWords: 250, maxWords: 450,  tone:'lite mer komplex; problem som löses; korta kapitel', chapters:1 };
      case '7-8':  return { minWords: 400, maxWords: 700,  tone:'äventyr/mysterier; enkla cliffhangers', chapters:2 };
      case '9-10': return { minWords: 600, maxWords: 1000, tone:'fantasy/vänskap/moral; kapitel 2–3 sidor', chapters:2 };
      case '11-12':return { minWords: 900, maxWords: 1400, tone:'djupare teman; karaktärsutveckling', chapters:3 };
      default:     return { minWords: 250, maxWords: 500,  tone:'barnvänlig', chapters:1 };
    }
  };

  const buildStoryPayload = () => {
    const age = (ageRange?.value || '').trim();
    return {
      childName: (childName?.value || '').trim(),
      heroName:  (heroName?.value  || '').trim(),
      ageRange:  age,
      prompt:    (promptEl?.value  || '').trim(),
      controls:  ageToControls(age),
      quality:   'kids_v1'
    };
  };

  // ===== Helpers =====
  async function postJSON(url, body, signal) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(body),
      signal
    });
  }

  function playBlob(blob, mime='audio/mpeg') {
    if (!resultAudio) return;
    const url = URL.createObjectURL(blob);
    resultAudio.src = url;
    resultAudio.hidden = false;
    resultAudio.play().catch(()=>{});
  }

  async function handleTTSResponse(res) {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('audio/')) {
      const blob = await res.blob();
      playBlob(blob, ct);
      return;
    }
    const data = await res.json().catch(()=> ({}));
    if (data?.audioBase64) {
      const bin = atob(data.audioBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
      playBlob(new Blob([bytes], { type: 'audio/mpeg' }));
      return;
    }
    if (data?.audioUrl) {
      resultAudio.src = data.audioUrl;
      resultAudio.hidden = false;
      await resultAudio.play().catch(()=>{});
      return;
    }
    throw new Error(data?.error || 'TTS gav inget ljud.');
  }

  // ===== Skapa saga + TTS (med spinner) =====
  btnGenerate?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (isBusy) return;

    // reset UI
    resultText.textContent = '';
    resultAudio.hidden = true;
    resultAudio.removeAttribute('src');

    const payload = buildStoryPayload();
    if (!payload.prompt) {
      setStatus('Skriv något i “Sagognista” eller tala in först.', 'error');
      return;
    }

    setBusy(true);
    setStatus('Skapar saga…');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 1000 * 120);

    try {
      showSpinner('Skapar sagan…');
      const storyRes = await postJSON('/api/generate_story', { ...payload, read_aloud:true }, ac.signal);
      if (!storyRes.ok) {
        const t = await storyRes.text().catch(()=> '');
        throw new Error(`Serverfel (story): ${storyRes.status} ${t}`);
      }
      const storyData = await storyRes.json();
      if (!storyData?.story) throw new Error('Tomt svar från generate_story.');
      resultText.textContent = storyData.story;

      spinnerMsg.textContent = 'Skapar uppläsning…';
      setStatus('Skapar uppläsning…');
      const ttsRes = await postJSON('/tts', {
        text: storyData.story,
        voice: 'alloy',
        format: 'mp3',
        speed: 1.0
      }, ac.signal);
      if (!ttsRes.ok) {
        const t = await ttsRes.text().catch(()=> '');
        throw new Error(`Serverfel (tts): ${ttsRes.status} ${t}`);
      }
      await handleTTSResponse(ttsRes);

      setStatus('Klar!', 'ok');
    } catch (err) {
      setStatus((err?.message || String(err)), 'error');
    } finally {
      clearTimeout(timer);
      hideSpinner();
      setBusy(false);
    }
  });

  // ===== TAL → WHISPER (använd alltid multipart + path-fallback) =====
  let mediaRecorder = null;
  let chunks = [];

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    // Välj format som de flesta browsers klarar; Workers bryr sig inte om mimetypen här
    const opts = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? { mimeType: 'audio/webm;codecs=opus' }
      : { mimeType: 'audio/webm' };
    mediaRecorder = new MediaRecorder(stream, opts);
    mediaRecorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = () => { void sendToWhisper(new Blob(chunks, { type: 'audio/webm' })); };
    mediaRecorder.start();
    btnSpeak?.classList.add('is-recording');
    setBusy(true);
    setStatus('Spelar in… tryck “Tala in” igen för att stoppa.');
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      // släpp mic
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
  }

  async function sendToWhisper(blob) {
    try {
      showSpinner('Gör text av talet…');
      setStatus('Transkriberar tal…');

      // Skicka ALLTID multipart/form-data (bäst kompatibilitet)
      const fd = new FormData();
      fd.append('file', blob, 'speech.webm');

      // Prova /api/whisper_transcribe, fallback /whisper_transcribe
      let res = await fetch('/api/whisper_transcribe', { method: 'POST', body: fd });
      if (!res.ok && (res.status === 404 || res.status === 405)) {
        res = await fetch('/whisper_transcribe', { method: 'POST', body: fd });
      }
      if (!res.ok) {
        const t = await res.text().catch(()=> '');
        throw new Error(`Whisper fel: ${res.status} ${t}`);
      }

      const data = await res.json();
      const text = (data?.text || '').trim();
      if (text) {
        promptEl.value = text;
        setStatus('Talet omvandlat till text ✅', 'ok');
      } else {
        setStatus('Kunde inte tolka talet (tomt svar).', 'error');
      }
    } catch (e) {
      setStatus(`Kunde inte transkribera: ${e?.message || e}`, 'error');
    } finally {
      btnSpeak?.classList.remove('is-recording');
      hideSpinner();
      setBusy(false);
    }
  }

  btnSpeak?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (btnSpeak.classList.contains('is-recording')) {
      stopRecording();
    } else {
      try { await startRecording(); }
      catch (err) {
        setStatus(`Mikrofon fel: ${err?.message || err}`, 'error');
        btnSpeak?.classList.remove('is-recording');
        setBusy(false);
      }
    }
  });

  // ===== Hjältar lokalt =====
  const heroKey = 'bn_heroes_v1';
  const loadHeroes = () => { try { return JSON.parse(localStorage.getItem(heroKey) || '[]'); } catch { return []; } };
  const saveHeroes = (list) => localStorage.setItem(heroKey, JSON.stringify(list.slice(0, 50)));

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

  setStatus('');
})();
