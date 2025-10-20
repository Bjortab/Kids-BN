// public/app.js  (hel fil)

(() => {
  const $ = sel => document.querySelector(sel);

  // Inputs/knappar
  const childName = $('#childName');
  const ageRange  = $('#ageRange');
  const prompt    = $('#prompt');
  const heroName  = $('#heroName');
  const useWhisper= $('#useWhisper');

  const btnSpeak     = $('#btnSpeak');
  const btnGenerate  = $('#btnGenerate');
  const btnSaveHero  = $('#btnSaveHero');
  const btnResetHeroes = $('#btnResetHeroes');

  // Status/UI
  const statusEl   = $('#status');
  const resultText = $('#resultText');
  const resultAudio= $('#resultAudio');

  // Spinner + cache-meter
  const ttsSpinner = $('#ttsSpinner');
  const cacheWrap  = $('#cacheWrap');
  const cacheBar   = $('#cacheBar');
  const cacheText  = $('#cacheText');

  const storyImagesWrap = $('#storyImages');

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

  function showSpinner(show){ if(ttsSpinner) ttsSpinner.hidden = !show; }
  function updateCacheMeterFromHeader(h) {
    if (!cacheWrap || !cacheBar || !cacheText) return;
    const flag = (h.get('x-tts-cache') || '').toUpperCase(); // HIT / MISS / HIT_FUZZY_92%
    let pct = 0;
    if (flag.startsWith('HIT_FUZZY_')) {
      const m = flag.match(/HIT_FUZZY_(\d+)%/);
      pct = m ? parseInt(m[1],10) : 75;
    } else if (flag === 'HIT') {
      pct = 100;
    } else if (flag === 'MISS') {
      pct = 0;
    }
    cacheBar.style.width = `${pct}%`;
    cacheText.textContent = `TTS-cache: ${flag || '—'}`;
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

  // Hjälte-lokalt
  const heroKey = 'bn_heroes_v1';
  const loadHeroes = () => { try { return JSON.parse(localStorage.getItem(heroKey) || '[]'); } catch { return []; } };
  const saveHeroes = (list) => localStorage.setItem(heroKey, JSON.stringify(list.slice(0, 50)));

  // Ålderskontroller (oförändrat, men du kan finjustera längder/toner senare)
  const ageToControls = (age) => {
    switch (age) {
      case '1-2':  return { minWords: 40,  maxWords: 120,  tone:'bilderbok; upprepning; byt sida; ljudord', chapters:1 };
      case '3-4':  return { minWords: 120, maxWords: 260,  tone:'enkel röd tråd, humor, tryggt',                chapters:1 };
      case '5-6':  return { minWords: 220, maxWords: 450,  tone:'problem–lösning, lekfullt, mod',               chapters:1 };
      case '7-8':  return { minWords: 400, maxWords: 700,  tone:'äventyr, mysterium, cliffhangers',            chapters:2 };
      case '9-10': return { minWords: 600, maxWords: 1000, tone:'fantasy/vänskap/motgångar',                   chapters:2 };
      case '11-12':return { minWords: 900, maxWords: 1600, tone:'tematik, val, konsekvens; ingen harmlös moralplåsterfinal', chapters:3 };
      default:     return { minWords: 250, maxWords: 500,  tone:'barnvänlig',                                  chapters:1 };
    }
  };

  // Din befintliga payload-byggare
  const buildStoryPayload = () => {
    const age = ageRange.value;
    return {
      childName: (childName.value || '').trim(),
      heroName:  (heroName.value  || '').trim(),
      ageRange:  age,
      prompt:    (prompt.value    || '').trim(),
      controls:  ageToControls(age)
    };
  };

  // === Generera saga + TTS + (ev. bilder) ===
  btnGenerate?.addEventListener('click', async () => {
    if (isBusy) return;
    const payload = buildStoryPayload();
    if (!payload.prompt && !useWhisper?.checked) {
      setStatus('Skriv något i sagognistan eller tala in.', 'error'); return;
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

      // 2) TTS (med cache-headrar)
      setStatus('Skapar uppläsning…');
      showSpinner(true);
      const ttsBody = {
        text: data.story,
        // Byt röst genom att ändra detta värde eller ha en select i UI:
        voiceId: '',           // tom = använd serverns default (ELEVENLABS_VOICE_ID)
        model:   'elevenlabs-v1',
        lang:    'sv'
      };
      const resTTS = await fetch('/tts', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(ttsBody)
      });
      if (!resTTS.ok) throw new Error(`TTS: ${resTTS.status} ${await resTTS.text().catch(()=> '')}`);

      // Läs cache-headrar och visa mätare
      updateCacheMeterFromHeader(resTTS.headers);

      const blob = await resTTS.blob();
      const url = URL.createObjectURL(blob);
      resultAudio.src = url;
      resultAudio.hidden = false;

      // 3) (valfritt) bilder, lämnar som tidigare
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

  // Hjältar (oförändrat)
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
