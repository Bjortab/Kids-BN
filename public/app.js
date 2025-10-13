(() => {
  // ===== DOM =====
  const $ = sel => document.querySelector(sel);
  const childName = $('#childName');
  const ageRange = $('#ageRange');
  const prompt = $('#prompt');
  const heroName = $('#heroName');
  const useWhisper = $('#useWhisper');
  const btnSpeak = $('#btnSpeak');
  const btnGenerate = $('#btnGenerate');
  const btnSaveHero = $('#btnSaveHero');
  const btnResetHeroes = $('#btnResetHeroes');
  const statusEl = $('#status');
  const resultText = $('#resultText');
  const resultAudio = $('#resultAudio');

  // ===== State guard =====
  let isBusy = false;
  const setBusy = (v, msg = '') => {
    isBusy = v;
    [btnSpeak, btnGenerate, btnSaveHero, btnResetHeroes].forEach(b => { if (b) b.disabled = v; });
    if (msg) setStatus(msg);
  };

  const setStatus = (msg, type = '') => {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.remove('status--ok', 'status--error');
    if (type) statusEl.classList.add(`status--${type}`);
  };

  // ===== Utilities =====
  const heroKey = 'bn_heroes_v1';
  const loadHeroes = () => {
    try { return JSON.parse(localStorage.getItem(heroKey) || '[]'); }
    catch { return []; }
  };
  const saveHeroes = (list) => localStorage.setItem(heroKey, JSON.stringify(list.slice(0, 50)));

  const ageToControls = (age) => {
    switch (age) {
      case '1-2':  return { minWords: 50,  maxWords: 160,  tone:'bilderbok, rim, färger, ljud och upprepningar', chapters:1 };
      case '3-4':  return { minWords: 120, maxWords: 280,  tone:'enkel handling med tydlig början och slut; humor och igenkänning', chapters:1 };
      case '5-6':  return { minWords: 250, maxWords: 450,  tone:'lite mer komplexa berättelser med problem som löses; korta kapitel', chapters:1 };
      case '7-8':  return { minWords: 400, maxWords: 700,  tone:'äventyr och mysterier, humor; introducera serier och cliffhangers', chapters:2 };
      case '9-10': return { minWords: 600, maxWords: 1000, tone:'fantasy/vänskap/moralfrågor; kapitelberättelse, 2–3 sidor', chapters:2 };
      case '11-12':return { minWords: 900, maxWords: 1400, tone:'djupare teman och karaktärsutveckling; kapitel', chapters:3 };
      default:     return { minWords: 250, maxWords: 500,  tone:'barnvänlig', chapters:1 };
    }
  };

  const buildStoryPayload = () => {
    const age = (ageRange?.value || '').trim();
    const controls = ageToControls(age);
    return {
      childName: (childName?.value || '').trim(),
      heroName: (heroName?.value || '').trim(),
      ageRange: age,
      prompt: (prompt?.value || '').trim(),
      controls
    };
  };

  // ===== Recording (browser) -> Whisper function (oförändrat stub-läge) =====
  let mediaRecorder, chunks = [];
  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    mediaRecorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      try{
        const blob = new Blob(chunks, { type: 'audio/webm' });
        await sendToWhisper(blob);
      } catch(err){
        setStatus('Kunde inte transkribera: ' + (err?.message || err), 'error');
      }
    };
    mediaRecorder.start();
    setStatus('Spelar in… tryck ”Tala in” igen för att stoppa.');
    btnSpeak?.classList.add('is-recording');
  };
  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    btnSpeak?.classList.remove('is-recording');
  };
  const sendToWhisper = async (blob) => {
    setBusy(true, 'Skickar ljud till Whisper…');
    const res = await fetch('/api/whisper_transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm' },
      body: blob
    });
    if (!res.ok) {
      const txt = await res.text().catch(()=> '');
      setBusy(false, '');
      throw new Error(`Whisper svarade inte: ${res.status} ${txt}`);
    }
    const data = await res.json();
    if (prompt) prompt.value = (data.text || '').trim();
    setBusy(false, 'Lokal inspelning klar.');
  };

  btnSpeak?.addEventListener('click', async () => {
    try{
      if (isBusy && btnSpeak.classList.contains('is-recording')) { stopRecording(); return; }
      await startRecording();
    }catch(err){
      setStatus('Mikrofon fel: ' + (err?.message || err), 'error');
    }
  });

  // ===== Skapa saga + TTS =====
  btnGenerate?.addEventListener('click', async () => {
    if (isBusy) return;
    const payload = buildStoryPayload();

    if (!payload.prompt && !useWhisper?.checked) {
      setStatus('Skriv något i sagognistan eller tala in.', 'error');
      return;
    }

    setBusy(true, 'Skapar saga…');
    if (resultText) resultText.textContent = '';
    if (resultAudio) { resultAudio.hidden = true; resultAudio.removeAttribute('src'); }

    try{
      // 1) Generera sagan
      const res = await fetch('/api/generate_story', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ ...payload, read_aloud:true })
      });

      if (res.status === 405){
        setBusy(false, '');
        setStatus('Misslyckades: 405 Method Not Allowed. Kontrollera att functions/api/generate_story.js exporterar onRequestPost.', 'error');
        return;
      }
      if (!res.ok){
        const t = await res.text().catch(()=> '');
        throw new Error(`${res.status} ${t}`);
      }

      const data = await res.json();
      const story = data.story || '';
      if (resultText) resultText.textContent = story;

      // 2) Riktig TTS (OpenAI)
      setStatus('Skapar uppläsning…');
      const tts = await fetch('/tts', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          text: story,
          voice: 'alloy',   // ändra om du vill prova andra röster när de blir tillgängliga
          format: 'mp3',
          speed: 1.0
        })
      });

      if (!tts.ok) {
        const errT = await tts.text().catch(()=> '');
        throw new Error(`TTS-fel: ${tts.status} ${errT}`);
      }

      // Växla på audio-spelaren med den strömmade MP3:an
      const blob = await tts.blob();
      const url = URL.createObjectURL(blob);
      if (resultAudio) {
        resultAudio.src = url;
        resultAudio.hidden = false;
        // försök autoplay (tillåts om klick skedde)
        resultAudio.play().catch(() => {});
      }

      setBusy(false, 'Klar!', 'ok');
    }catch(err){
      setBusy(false, '');
      setStatus('Kunde inte skapa sagan/ljud: '+ (err?.message || err), 'error');
    }
  });

  // ===== Hjältar lokalt =====
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

  setStatus('');
})();
