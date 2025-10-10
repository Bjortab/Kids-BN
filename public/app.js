// public/app.js

document.addEventListener('DOMContentLoaded', () => {
  const $ = (sel) => document.querySelector(sel);

  const nameEl   = $('#childName');
  const ageEl    = $('#ageRange');
  const promptEl = $('#prompt');
  const heroEl   = $('#heroName');
  const recBtn   = $('#btnRecord');
  const createBtn= $('#btnCreate');
  const clearBtn = $('#btnClearHeroes');
  const resultEl = $('#result');

  const missing = [
    ['#childName',nameEl],['#ageRange',ageEl],['#prompt',promptEl],
    ['#heroName',heroEl],['#btnRecord',recBtn],['#btnCreate',createBtn],
    ['#btnClearHeroes',clearBtn],['#result',resultEl]
  ].filter(([_,el]) => !el);

  if (missing.length) {
    console.error('Saknade element:', missing.map(m=>m[0]).join(', '));
    if (resultEl) resultEl.innerHTML = `<div class="error">Fel i HTML: saknar ${missing.map(m=>m[0]).join(', ')}</div>`;
    return;
  }

  console.log('[BN] app.js laddad och element funna');

  // ------- UI helpers -------
  function setBusy(on) {
    createBtn.disabled = on;
    recBtn.disabled = on;
    createBtn.textContent = on ? 'Skapar saga…' : 'Skapa saga (med uppläsning)';
  }
  function show(msg, cls='info') {
    resultEl.innerHTML = `<div class="${cls}">${msg}</div>`;
  }
  function showStory(text) {
    resultEl.innerHTML = `<div class="story">${escapeHTML(text)}</div>`;
  }
  const escapeHTML = (s)=>s.replace(/[&<>]/g,ch=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[ch]));

  // ------- Network helpers -------
  async function apiJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
    let data;
    try { data = await res.json(); } catch { data = { ok:false, error:`${res.status} ${res.statusText}`}; }
    if (!data.ok) throw new Error(data.error || `Misslyckades (${res.status})`);
    return data;
  }

  async function transcribeBlob(blob) {
    const fd = new FormData();
    fd.append('audio', blob, 'recording.webm');
    const res = await fetch('/api/whisper_transcribe', { method:'POST', body: fd });
    const data = await res.json().catch(()=>({ ok:false, error:'Ogiltigt svar från whisper' }));
    if (!data.ok) throw new Error(data.error || 'Transkribering misslyckades');
    return data.text || '';
  }

  async function tts(text) {
    const { audioBase64 } = await apiJSON('/api/tts', { text });
    return audioBase64;
  }

  async function generateStory(payload) {
    const { story } = await apiJSON('/api/generate_story', payload);
    return story;
  }

  // ------- Åldersregler (ordlängd m.m.) -------
  function agePolicy(ageRange){
    switch(ageRange){
      case '1–2': return { min:50,  max:200, tone:'rim, ljud, färger' };
      case '3–4': return { min:180, max:350, tone:'enkel handling, tydligt slut' };
      case '5–6': return { min:300, max:600, tone:'lite mer komplex handling, problemlösning' };
      case '7–8': return { min:500, max:900, tone:'äventyr, mysterier, humor' };
      case '9–10':return { min:800, max:1200,tone:'fantasy, vänskap, moraliska frågor' };
      case '11–12':return{ min:1000,max:1600,tone:'djupare teman, karaktärsutveckling' };
      default:     return { min:250, max:600, tone:'barnvänlig' };
    }
  }

  // ------- Hjältar (localStorage) -------
  function loadHeroes(){ try { return JSON.parse(localStorage.getItem('bn_heroes')||'[]'); } catch { return []; } }
  function saveHero(name){ if(!name) return; const list = loadHeroes(); if(!list.includes(name)) { list.push(name); localStorage.setItem('bn_heroes', JSON.stringify(list)); } }
  function clearHeroes(){ localStorage.removeItem('bn_heroes'); show('Sparade hjältar rensade.'); }

  clearBtn.addEventListener('click', clearHeroes);

  // ------- Inspelning / Whisper -------
  let mediaRecorder, chunks=[];
  recBtn.addEventListener('click', async () => {
    try {
      console.log('[BN] Klick: Tala in');
      if (!mediaRecorder) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = e => chunks.push(e.data);
        mediaRecorder.onstop = async () => {
          const blob = new Blob(chunks, { type:'audio/webm' });
          chunks = [];
          try {
            setBusy(true);
            const text = await transcribeBlob(blob);
            promptEl.value = text;
            show('Lokal inspelning klar. Texten är införd i rutan.');
          } catch (e) {
            console.error(e);
            show(`Kunde inte transkribera: ${e.message}`, 'error');
          } finally {
            setBusy(false);
          }
        };
      }
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        recBtn.textContent = 'Tala in';
      } else {
        chunks = [];
        mediaRecorder.start();
        recBtn.textContent = 'Stoppa inspelning';
        show('Spelar in… Klicka igen för att stoppa.');
      }
    } catch (e) {
      console.error(e);
      show(`Mikrofonfel: ${e.message}`, 'error');
    }
  });

  // ------- Skapa saga + TTS -------
  createBtn.addEventListener('click', async () => {
    console.log('[BN] Klick: Skapa saga');
    const name = (nameEl.value||'').trim();
    const ageRange = ageEl.value;
    const prompt = (promptEl.value||'').trim();
    const heroName = (heroEl.value||'').trim() || null;

    if (!name || !prompt) {
      show('Fyll i barnets namn och en kort beskrivning först.', 'error');
      return;
    }

    const policy = agePolicy(ageRange);

    try {
      setBusy(true);
      show('Skapar saga…');

      const story = await generateStory({
        name, ageRange, prompt, heroName,
        minWords: policy.min, maxWords: policy.max, ageTone: policy.tone
      });

      // Spara ev. ny hjälte som inte “läckt in” från tidigare
      if (heroName) saveHero(heroName);

      showStory(story);

      // Skapa uppläsning direkt
      try {
        show('Skapar uppläsning…');
        const audioUrl = await tts(story);
        const audio = new Audio(audioUrl);
        await audio.play().catch(err => console.warn('Autoplay stoppad av webbläsaren:', err));
        show('Saga klar ✅ (uppläsning spelas upp)');
      } catch (e) {
        console.warn(e);
        show(`Saga klar, men uppläsningen misslyckades: ${e.message}`, 'warn');
      }
    } catch (e) {
      console.error(e);
      show(`Misslyckades: ${e.message}`, 'error');
    } finally {
      setBusy(false);
    }
  });

  console.log('[BN] Event-lyssnare monterade');
});
