// public/app.js
(() => {
  const $ = s => document.querySelector(s);

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

  const storySpinner = $('#storySpinner');
  const ttsSpinner   = $('#ttsSpinner');

  const cacheWrap  = $('#cacheWrap');
  const cacheBar   = $('#cacheBar');
  const cacheText  = $('#cacheText');

  let isBusy = false;
  const setBusy = (v, msg='') => {
    isBusy = v;
    [btnSpeak, btnGenerate, btnSaveHero, btnResetHeroes].forEach(b => b && (b.disabled = v));
    setStatus(msg);
  };
  const setStatus = (m, type='') => {
    if (!statusEl) return;
    statusEl.textContent = m || '';
    statusEl.classList.remove('status--ok','status--error');
    if (type) statusEl.classList.add(`status--${type}`);
  };
  const show = (el, on) => { if (el) el.hidden = !on; };
  const updateCacheMeter = (hits, total) => {
    if (!cacheWrap || !cacheBar || !cacheText) return;
    const pct = total > 0 ? Math.round((hits/total)*100) : 0;
    cacheBar.style.width = `${pct}%`;
    cacheText.textContent = `Återanvänt från minnet: ${pct}% (${hits}/${total})`;
    cacheWrap.hidden = false;
  };

  const ageToControls = (age) => {
    switch (age) {
      case '1-2':  return { minWords: 50,  maxWords: 160,  tone:'bilderbok, rim, färger, ljud och upprepningar', chapters:1 };
      case '3-4':  return { minWords: 120, maxWords: 280,  tone:'enkel handling med tydlig början och slut; humor och igenkänning', chapters:1 };
      case '5-6':  return { minWords: 250, maxWords: 450,  tone:'lite mer komplexa berättelser med problem som löses; korta kapitel', chapters:1 };
      case '7-8':  return { minWords: 400, maxWords: 700,  tone:'äventyr och mysterier, humor; introducera serier och cliffhangers', chapters:2 };
      case '9-10': return { minWords: 600, maxWords: 1000, tone:'fantasy/vänskap/moralfrågor; kapitelberättelse, 2–3 sidor', chapters:2 };
      case '11-12':return { minWords: 900, maxWords: 1600, tone:'mognare stil, tydligt driv, mindre “gulligt”', chapters:3 };
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
    cacheWrap && (cacheWrap.hidden = true);

    try {
      // STORY
      setBusy(true, 'Skapar saga…');
      show(storySpinner, true);
      const resStory = await fetch('/api/generate_story', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ ...payload, read_aloud:true })
      });
      show(storySpinner, false);

      if (!resStory.ok) throw new Error(`Story: ${resStory.status} ${await resStory.text().catch(()=> '')}`);
      const data = await resStory.json();
      if (data.story) resultText.textContent = data.story;

      // TTS
      setStatus('Skapar uppläsning…');
      show(ttsSpinner, true);
      const resTTS = await fetch('/tts', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ text: data.story, voiceId: '' })
      });
      show(ttsSpinner, false);

      if (!resTTS.ok) throw new Error(`TTS: ${resTTS.status} ${await resTTS.text().catch(()=> '')}`);

      const hits  = parseInt(resTTS.headers.get('x-tts-hits')  || '0', 10);
      const total = parseInt(resTTS.headers.get('x-tts-total') || '0', 10);
      updateCacheMeter(hits, total);

      const blob = await resTTS.blob();
      const url = URL.createObjectURL(blob);
      resultAudio.src = url;
      resultAudio.hidden = false;

      setBusy(false, 'Klar!', 'ok');
      resultAudio.play().catch(()=>{});
    } catch (err) {
      show(storySpinner, false);
      show(ttsSpinner, false);
      setBusy(false, '');
      setStatus('Kunde inte skapa sagan: ' + (err?.message || err), 'error');
    }
  });

  // Hjältar (oförändrat)
  const heroKey = 'bn_heroes_v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(heroKey) || '[]'); } catch { return []; } };
  const save = (list) => localStorage.setItem(heroKey, JSON.stringify(list.slice(0, 50)));

  btnSaveHero?.addEventListener('click', () => {
    const h = (heroName.value || '').trim();
    if (!h){ setStatus('Skriv ett hjältenamn först.', 'error'); return; }
    const list = load();
    if (!list.includes(h)) list.unshift(h);
    save(list);
    setStatus(`Sparade hjälten: ${h}`, 'ok');
  });
  btnResetHeroes?.addEventListener('click', () => {
    save([]);
    setStatus('Rensade sparade hjältar.', 'ok');
  });

  setStatus('');
})();
