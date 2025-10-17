// public/app.js
(() => {
  const $ = sel => document.querySelector(sel);

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
  const ttsSpinner = $('#ttsSpinner');

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
  const showSpinner = (on) => { if (ttsSpinner) ttsSpinner.hidden = !on; };

  const ageToControls = (age) => {
    switch (age) {
      case '1-2':  return { minWords: 50,  maxWords: 160,  tone:'bilderbok, rim, färger, ljud och upprepningar', chapters:1 };
      case '3-4':  return { minWords: 120, maxWords: 280,  tone:'enkel handling med tydlig början och slut; humor och igenkänning', chapters:1 };
      case '5-6':  return { minWords: 250, maxWords: 450,  tone:'lite mer komplexa berättelser med problem som löses; korta kapitel', chapters:1 };
      case '7-8':  return { minWords: 400, maxWords: 700,  tone:'äventyr och mysterier, humor; introducera serier och cliffhangers', chapters:2 };
      case '9-10': return { minWords: 600, maxWords: 1000, tone:'fantasy/vänskap/moralfrågor; kapitelberättelse, 2–3 sidor', chapters:2 };
      case '11-12':return { minWords: 900, maxWords: 1600, tone:'djupare teman och karaktärsutveckling; kapitel', chapters:3 };
      default:     return { minWords: 250, maxWords: 500,  tone:'barnvänlig', chapters:1 };
    }
  };
  const buildPayload = () => {
    const age = ageRange.value;
    return {
      childName: (childName.value || '').trim(),
      heroName:  (heroName.value || '').trim(),
      ageRange:  age,
      prompt:    (prompt.value || '').trim(),
      controls:  ageToControls(age)
    };
  };

  btnGenerate?.addEventListener('click', async () => {
    if (isBusy) return;
    const payload = buildPayload();
    if (!payload.prompt && !useWhisper?.checked) {
      setStatus('Skriv något i sagognistan eller tala in.', 'error');
      return;
    }

    resultText.textContent = '';
    resultAudio.hidden = true;
    resultAudio.removeAttribute('src');
    showSpinner(false);

    try {
      setBusy(true, 'Skapar saga…');
      const resStory = await fetch('/api/generate_story', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      });
      if (!resStory.ok) throw new Error(`Story: ${resStory.status} ${await resStory.text().catch(()=> '')}`);
      const j = await resStory.json();
      const story = (j.story || '').trim();
      if (!story) throw new Error('Tom saga.');
      resultText.textContent = story;

      // TTS
      setStatus('Skapar uppläsning…');
      showSpinner(true);
      const resTTS = await fetch('/tts', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ text: story })
      });
      if (!resTTS.ok) throw new Error(`TTS: ${resTTS.status} ${await resTTS.text().catch(()=> '')}`);

      const blob = await resTTS.blob();
      const url = URL.createObjectURL(blob);
      resultAudio.src = url;
      resultAudio.hidden = false;

      showSpinner(false);
      setBusy(false, 'Klar!', 'ok');
      resultAudio.play().catch(()=>{});
    } catch (err) {
      showSpinner(false);
      setBusy(false, '');
      setStatus('Kunde inte skapa sagan: ' + (err?.message || err), 'error');
    }
  });

  // Hjältar (lokal sparning)
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
