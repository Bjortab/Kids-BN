(() => {
  // ===== DOM =====
  const $ = sel => document.querySelector(sel);
  const childName = $('#childName');
  const ageRange  = $('#ageRange');
  const prompt    = $('#prompt');
  const heroName  = $('#heroName');
  const useWhisper = $('#useWhisper');            // (finns i ditt UI)
  const useImages  = $('#useImages');             // <— kryssrutan "Skapa bilder till sagan"
  const btnSpeak   = $('#btnSpeak');
  const btnGenerate= $('#btnGenerate');
  const btnSaveHero= $('#btnSaveHero');
  const btnReset   = $('#btnResetHeroes');
  const statusEl   = $('#status');
  const resultText = $('#resultText');
  const resultAudio= $('#resultAudio');

  // Här placerar vi media (skapas om det inte finns)
  let mediaBox = $('#mediaBox');
  if (!mediaBox) {
    mediaBox = document.createElement('div');
    mediaBox.id = 'mediaBox';
    mediaBox.style.marginTop = '12px';
    // lägg efter textresultatet
    const anchor = $('#result') || resultText?.parentElement || document.body;
    anchor.appendChild(mediaBox);
  }

  // ===== State guard =====
  let isBusy = false;
  const setBusy = (v, msg = '') => {
    isBusy = v;
    [btnSpeak, btnGenerate, btnSaveHero, btnReset].forEach(b => b && (b.disabled = v));
    if (msg) setStatus(msg);
  };

  const setStatus = (msg, type = '') => {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.remove('status--ok', 'status--error');
    if (type) statusEl.classList.add(`status--${type}`);
  };

  // ===== Hjälp: text→kategori =====
  const knownCats = ['dragon','bunny','pirate','princess','dino','space'];
  function guessCategoryFromPrompt(txt) {
    const t = (txt || '').toLowerCase();
    for (const k of knownCats) {
      if (t.includes(k)) return k;
      // svenska synonymer
      if (k === 'dragon'    && (t.includes('drake') || t.includes('drakar'))) return 'dragon';
      if (k === 'bunny'     && (t.includes('kanin') || t.includes('kaniner'))) return 'bunny';
      if (k === 'pirate'    && (t.includes('pirat'))) return 'pirate';
      if (k === 'princess'  && (t.includes('prinsess'))) return 'princess';
      if (k === 'dino'      && (t.includes('dino') || t.includes('dinosaur'))) return 'dino';
      if (k === 'space'     && (t.includes('rymd') || t.includes('planeter'))) return 'space';
    }
    return ''; // okänd
  }

  // ===== Heroer (lokal lagring) =====
  const heroKey = 'bn_heroes_v1';
  const loadHeroes = () => { try { return JSON.parse(localStorage.getItem(heroKey)||'[]'); } catch { return []; } };
  const saveHeroes = (list) => localStorage.setItem(heroKey, JSON.stringify(list.slice(0,50)));

  // ====== DIN BEFINTLIGA DEL – OFÖRÄNDRAD (saga + TTS) ======
  async function createStoryAndTTS() {
    const payload = {
      childName: (childName?.value||'').trim(),
      ageRange : (ageRange?.value||'').trim(),
      prompt   : (prompt?.value||'').trim(),
      heroName : (heroName?.value||'').trim(),
      read_aloud: true
    };
    if (!payload.prompt && !useWhisper?.checked) {
      throw new Error('Skriv något i sagognistan eller tala in.');
    }

    // 1) Skapa sagan
    const res = await fetch('/api/generate_story', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const t = await res.text().catch(()=> '');
      throw new Error(`Kunde inte skapa sagan: ${res.status} ${t}`);
    }
    const data = await res.json();
    if (data.story) resultText.textContent = data.story;

    // 2) Spelare för TTS (du har redan backend som svarar efter ~10s)
    if (data.audioUrl) {
      resultAudio.src = data.audioUrl;
      resultAudio.hidden = false;
      // Autoplay
      resultAudio.play().catch(()=>{ /* kräver user gesture */ });
    } else {
      // fall-back (backend streamar ljudet direkt efteråt)
      resultAudio.hidden = false;
    }

    return data;
  }

  // ===== MEDIA från R2 via API =====
  function showMediaSpinner() {
    mediaBox.innerHTML = '';
    const s = document.createElement('div');
    s.textContent = 'Hämtar bild/animation…';
    s.style.fontSize = '14px';
    s.style.opacity  = '0.8';
    s.style.padding  = '8px 0';
    mediaBox.appendChild(s);
  }

  async function loadCategoryMedia(category) {
    try {
      showMediaSpinner();
      const url = `/api/pick_media?category=${encodeURIComponent(category)}`;
      const res = await fetch(url, { method:'GET' });
      if (!res.ok) throw new Error(`Media ${res.status}`);

      const ctype = res.headers.get('content-type') || '';
      const blob  = await res.blob();
      mediaBox.innerHTML = '';

      if (ctype.startsWith('video/')) {
        const v = document.createElement('video');
        v.controls = true;
        v.autoplay = true;
        v.loop = true;
        v.muted = true;        // så den får autoplay utan klick
        v.playsInline = true;
        v.style.maxWidth = '100%';
        v.src = URL.createObjectURL(blob);
        mediaBox.appendChild(v);
      } else if (ctype.startsWith('image/')) {
        const img = document.createElement('img');
        img.alt = category;
        img.style.maxWidth = '100%';
        img.style.borderRadius = '8px';
        img.src = URL.createObjectURL(blob);
        mediaBox.appendChild(img);
      } else {
        throw new Error('Okänt mediaformat');
      }
    } catch (e) {
      mediaBox.innerHTML = '';
      const small = document.createElement('div');
      small.style.fontSize = '12px';
      small.style.opacity = '0.8';
      small.textContent = 'Ingen bild/animation hittades för den här kategorin ännu.';
      mediaBox.appendChild(small);
    }
  }

  // ===== Handlers =====
  btnGenerate?.addEventListener('click', async () => {
    if (isBusy) return;
    setBusy(true, 'Skapar saga…');
    resultText.textContent = '';
    resultAudio.hidden = true; resultAudio.removeAttribute('src');
    mediaBox.innerHTML = '';

    try {
      const data = await createStoryAndTTS();

      // Hämta media om användaren bett om det
      if (useImages?.checked) {
        const cat = guessCategoryFromPrompt(prompt?.value || '');
        if (cat) await loadCategoryMedia(cat);
        else {
          mediaBox.textContent = 'Tips: skriv ord som ”drake”, ”kanin”, ”pirat” i sagognistan så visas passande bilder.';
        }
      }

      setBusy(false, 'Klar!', 'ok');
    } catch (err) {
      setBusy(false, '');
      setStatus(String(err?.message || err), 'error');
    }
  });

  btnSaveHero?.addEventListener('click', () => {
    const h = (heroName?.value || '').trim();
    if (!h) { setStatus('Skriv ett hjältenamn först.', 'error'); return; }
    const list = loadHeroes(); if (!list.includes(h)) list.unshift(h);
    saveHeroes(list);
    setStatus(`Sparade hjälten: ${h}`, 'ok');
  });

  btnReset?.addEventListener('click', () => {
    saveHeroes([]);
    setStatus('Rensade sparade hjältar.', 'ok');
  });

  setStatus('');
})();
