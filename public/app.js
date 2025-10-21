(() => {
  const $ = s => document.querySelector(s);

  // Fält
  const childName = $('#childName');
  const ageRange  = $('#ageRange');
  const prompt    = $('#prompt');
  const heroName  = $('#heroName');
  const voiceIn   = $('#voiceId');
  const useWhisper= $('#useWhisper');

  // Knappar
  const btnSpeak     = $('#btnSpeak');
  const btnGenerate  = $('#btnGenerate');
  const btnSaveHero  = $('#btnSaveHero');
  const btnReset     = $('#btnResetHeroes');

  // UI
  const statusEl     = $('#status');
  const resultText   = $('#resultText');
  const resultAudio  = $('#resultAudio');
  const spinnerStory = $('#spinnerStory');
  const spinnerTts   = $('#ttsSpinner');

  // cache-meter
  const cacheWrap = $('#cacheWrap');
  const cacheBar  = $('#cacheBar');
  const cacheText = $('#cacheText');

  // ——— helpers
  let busy = false;
  function setBusy(v, msg="") {
    busy = v;
    [btnSpeak, btnGenerate, btnSaveHero, btnReset].forEach(b => b && (b.disabled = v));
    setStatus(msg);
  }
  function setStatus(msg, type="") {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.classList.remove('status--ok','status--error');
    if (type) statusEl.classList.add(`status--${type}`);
  }
  function show(el, on){ if (el) el.hidden = !on; }

  // cache-meter uppdatering
  function updateCacheMeter(hits, total){
    if (!cacheWrap || !cacheBar || !cacheText) return;
    const ratio = total>0 ? Math.max(0, Math.min(1, hits/total)) : 0;
    const pct = Math.round(ratio*100);
    cacheBar.style.width = `${pct}%`;
    cacheText.textContent = `Återanvänt från minnet: ${pct}%`;
    cacheWrap.hidden = false;
  }

  // ålderskontroller (låst)
  const ageToControls = (age) => {
    switch (age) {
      case '1-2':  return { minChars: 60,  maxChars: 90,  minWords: 8,   maxWords: 20,  chapters:1, pageBreakTag:'[BYT SIDA]', styleHint:'pekbok; ljudord; korta satser' };
      case '3-4':  return { minWords: 80,  maxWords: 160, chapters:1, styleHint:'korta meningar; igenkänning; humor; 3–5 scener' };
      case '5-6':  return { minWords: 180, maxWords: 320, chapters:1, styleHint:'problem-lösning; enkel ton; naturligt slut' };
      case '7-8':  return { minWords: 250, maxWords: 500, chapters:2, styleHint:'äventyr/mysterium; tydlig val; naturligt slut' };
      case '9-10': return { minWords: 500, maxWords: 900, chapters:2, styleHint:'äventyr; varierade scener; naturligt slut' };
      case '11-12':return { minWords: 900, maxWords: 1600, chapters:3, styleHint:'tuffare ton; risker/uppoffring; naturligt slut' };
      default:     return { minWords: 250, maxWords: 500, chapters:1, styleHint:'barnvänlig; naturligt slut' };
    }
  };

  function buildStoryPayload(){
    const age = ageRange.value;
    return {
      childName: (childName?.value || '').trim(),
      heroName:  (heroName?.value || '').trim(),
      ageRange:  age,
      prompt:    (prompt?.value || '').trim(),
      controls:  ageToControls(age)
    };
  }

  // === GENERATE ===
  btnGenerate?.addEventListener('click', async () => {
    if (busy) return;
    const payload = buildStoryPayload();
    if (!payload.prompt && !useWhisper?.checked){
      setStatus('Skriv något i sagognistan eller tala in.', 'error');
      return;
    }

    // reset UI
    resultText.textContent = '';
    resultAudio.hidden = true;
    resultAudio.removeAttribute('src');
    cacheWrap.hidden = true;
    show(spinnerTts, false);
    show(spinnerStory, true);

    try{
      setBusy(true, 'Skapar saga…');

      // 1) Story
      const resStory = await fetch('/api/generate_story', {
        method:'POST',
        headers:{ 'content-type':'application/json' },
        body: JSON.stringify({ ...payload, read_aloud:true })
      });
      if (!resStory.ok) throw new Error(`Story: ${resStory.status} ${await resStory.text().catch(()=> '')}`);
      const data = await resStory.json();
      resultText.textContent = data.story || '';

      // 2) TTS (med valfri voiceId från input)
      show(spinnerStory, false);
      setStatus('Skapar uppläsning…');
      show(spinnerTts, true);

      const resTTS = await fetch('/tts', {
        method:'POST',
        headers:{ 'content-type':'application/json' },
        body: JSON.stringify({ text: data.story, voiceId: (voiceIn?.value||'').trim(), speed: 1.05 })
      });

      if (!resTTS.ok) {
        const err = await safeText(resTTS);
        throw new Error(`TTS: ${resTTS.status} ${err}`);
      }

      // Cache-headers
      const hits  = parseInt(resTTS.headers.get('x-tts-hits')  || '0', 10);
      const total = parseInt(resTTS.headers.get('x-tts-total') || '0', 10);
      updateCacheMeter(hits, total);

      // audio
      const blob = await resTTS.blob();
      const url  = URL.createObjectURL(blob);
      resultAudio.src = url;
      resultAudio.hidden = false;
      setStatus('Klar!', 'ok');
      show(spinnerTts, false);
      setBusy(false);
      resultAudio.play().catch(()=>{});
    } catch (err){
      show(spinnerStory, false);
      show(spinnerTts, false);
      setBusy(false, '');
      setStatus('Kunde inte skapa: ' + (err?.message || err), 'error');
    }
  });

  // === Hjältar (lokalt) ===
  const heroKey='bn_heroes_v1';
  const loadHeroes = () => { try { return JSON.parse(localStorage.getItem(heroKey)||'[]'); } catch { return []; } };
  const saveHeroes = (list) => localStorage.setItem(heroKey, JSON.stringify(list.slice(0,50)));

  btnSaveHero?.addEventListener('click', ()=>{
    const h = (heroName?.value||'').trim();
    if (!h){ setStatus('Skriv ett hjältenamn först.', 'error'); return; }
    const list = loadHeroes();
    if (!list.includes(h)) list.unshift(h);
    saveHeroes(list);
    setStatus(`Sparade hjälten: ${h}`, 'ok');
  });
  btnReset?.addEventListener('click', ()=>{
    saveHeroes([]);
    setStatus('Rensade sparade hjältar.', 'ok');
  });

  function safeText(res){ return res.text().catch(()=> ''); }
})();
