(() => {
  const $ = (sel) => document.querySelector(sel);

  // ====== DOM ======
  const childName     = $('#childName');
  const ageRange      = $('#ageRange');
  const promptEl      = $('#prompt');
  const heroName      = $('#heroName');
  const useWhisper    = $('#useWhisper');

  const btnSpeak      = $('#btnSpeak');
  const btnGenerate   = $('#btnGenerate');
  const btnSaveHero   = $('#btnSaveHero');
  const btnResetHeroes= $('#btnResetHeroes');

  const statusEl      = $('#status');
  const resultText    = $('#resultText');
  const resultAudio   = $('#resultAudio');

  // Spinner + cache-meter (lägg in motsvarande HTML/CSS)
  const ttsSpinner    = $('#ttsSpinner');
  const cacheWrap     = $('#cacheWrap');
  const cacheBar      = $('#cacheBar');
  const cacheText     = $('#cacheText');

  // (Valfritt) bildcontainer om du vill visa stillbilder senare
  const storyImages   = $('#storyImages');

  // ====== STATE / UI ======
  let isBusy = false;
  function setBusy(v, msg='') {
    isBusy = v;
    [btnSpeak, btnGenerate, btnSaveHero, btnResetHeroes].forEach(b => b && (b.disabled = v));
    setStatus(msg);
  }
  function setStatus(msg, type='') {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.remove('status--ok','status--error');
    if (type) statusEl.classList.add(`status--${type}`);
  }
  function showSpinner(on) {
    if (ttsSpinner) ttsSpinner.hidden = !on;
  }
  function updateCacheMeter(hits, total) {
    if (!cacheWrap || !cacheBar || !cacheText) return;
    const pct = total > 0 ? Math.round((hits/total)*100) : 0;
    cacheBar.style.width = `${pct}%`;
    cacheText.textContent = `Återanvänt från minnet: ${pct}%`;
    cacheWrap.hidden = false;
  }

  // ====== ÅLDER → LÄNGD/TON ======
  function ageToControls(age) {
    switch (age) {
      case '1-2':  return { minWords: 50,  maxWords: 160,  tone:'bilderbok, rim, färger, ljud och upprepningar', chapters:1 };
      case '3-4':  return { minWords: 120, maxWords: 280,  tone:'enkel handling med tydlig början och slut; humor och igenkänning', chapters:1 };
      case '5-6':  return { minWords: 250, maxWords: 450,  tone:'lite mer komplexa berättelser med problem som löses; korta kapitel', chapters:1 };
      case '7-8':  return { minWords: 400, maxWords: 700,  tone:'äventyr och mysterier, humor; introducera serier och cliffhangers', chapters:2 };
      case '9-10': return { minWords: 600, maxWords: 1000, tone:'fantasy, vänskap, moraliska frågor; mer dialog och tempo', chapters:2 };
      case '11-12':return { minWords: 900, maxWords: 1600, tone:'mognare språk, känslor, mysterium; val och konsekvenser', chapters:3 };
      default:     return { minWords: 250, maxWords: 500,  tone:'barnvänlig', chapters:1 };
    }
  }
  function buildPayload() {
    const age = (ageRange?.value || '').trim();
    return {
      childName: (childName?.value || '').trim(),
      heroName:  (heroName?.value  || '').trim(),
      ageRange:  age,
      prompt:    (promptEl?.value  || '').trim(),
      controls:  ageToControls(age)
    };
  }

  // ====== HJÄLTAR (lokalt minne i browsern) ======
  const HERO_KEY = 'bn_heroes_v1';
  function loadHeroes() {
    try { return JSON.parse(localStorage.getItem(HERO_KEY)||'[]'); }
    catch { return []; }
  }
  function saveHeroes(list) {
    localStorage.setItem(HERO_KEY, JSON.stringify(list.slice(0, 50)));
  }
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

  // ====== GENERERA SAGA + TTS ======
  btnGenerate?.addEventListener('click', async () => {
    if (isBusy) return;

    const payload = buildPayload();
    if (!payload.prompt && !useWhisper?.checked) {
      setStatus('Skriv något i sagognistan eller tala in.', 'error');
      return;
    }

    // Nollställ UI
    resultText && (resultText.textContent = '');
    if (resultAudio) {
      resultAudio.hidden = true;
      resultAudio.removeAttribute('src');
    }
    if (storyImages) storyImages.innerHTML = '';
    if (cacheWrap) cacheWrap.hidden = true;
    showSpinner(false);

    try {
      setBusy(true, 'Skapar saga…');

      // 1) STORY
      const resStory = await fetch('/api/generate_story', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      });
      if (!resStory.ok) throw new Error(`Story: ${resStory.status} ${await resStory.text().catch(()=> '')}`);
      const j = await resStory.json();
      const story = (j.story || '').trim();
      if (!story) throw new Error('Tom saga från servern.');
      if (resultText) resultText.textContent = story;

      // 2) TTS (med spinner + cachemätare)
      setStatus('Skapar uppläsning…');
      showSpinner(true);
      const resTTS = await fetch('/tts', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ text: story })
      });
      if (!resTTS.ok) throw new Error(`TTS: ${resTTS.status} ${await resTTS.text().catch(()=> '')}`);

      // Cache-mätare från headers
      const hits  = parseInt(resTTS.headers.get('x-tts-hits')  || '0', 10);
      const total = parseInt(resTTS.headers.get('x-tts-total') || '0', 10);
      if (!Number.isNaN(total)) updateCacheMeter(hits, total);

      // Spela upp
      const blob = await resTTS.blob();
      const url  = URL.createObjectURL(blob);
      if (resultAudio) {
        resultAudio.src = url;
        resultAudio.hidden = false;
        resultAudio.play().catch(()=>{});
      }

      showSpinner(false);
      setBusy(false, 'Klar!', 'ok');
    } catch (err) {
      showSpinner(false);
      setBusy(false, '');
      setStatus('Kunde inte skapa sagan: ' + (err?.message || err), 'error');
    }
  });

  // ====== (Valfritt) Tala in-knappen – säker stubb ======
  // Låter knappen “reagera” men gör inget farligt om du inte vill.
  // När du är redo: implementera MediaRecorder -> /api/whisper_transcribe och sätt promptEl.value.
  btnSpeak?.addEventListener('click', async () => {
    try {
      setStatus('Mikrofon-inspelning (inte aktiverad ännu)…');
      // TODO: implementera när du vill.
    } catch (e) {
      setStatus('Mikrofon fel: ' + (e?.message || e), 'error');
    } finally {
      // inget
    }
  });

  // Init
  setStatus('');
})();
