// public/app.js — BN front

document.addEventListener('DOMContentLoaded', () => {
  const $ = (sel) => document.querySelector(sel);

  const nameEl   = $('#childName');
  const ageEl    = $('#ageRange');
  const promptEl = $('#prompt');
  const heroEl   = $('#heroName');

  const recBtn   = $('#btnRecord');
  const createBtn= $('#btnCreate');
  const saveBtn  = $('#btnSaveHero');
  const clearBtn = $('#btnClearHeroes');

  const resultEl = $('#result');

  // Säkerhet: kontrollera att element finns (annars händer inget vid klick)
  const miss = [
    ['#childName',nameEl],['#ageRange',ageEl],['#prompt',promptEl],
    ['#heroName',heroEl],['#btnRecord',recBtn],['#btnCreate',createBtn],
    ['#btnSaveHero',saveBtn],['#btnClearHeroes',clearBtn],['#result',resultEl]
  ].filter(([,el]) => !el);
  if (miss.length) {
    console.error('Saknade element:', miss.map(m=>m[0]).join(', '));
    if (resultEl) resultEl.innerHTML = `<div class="error">Fel i HTML (saknar ${miss.map(m=>m[0]).join(', ')})</div>`;
    return;
  }

  // --- Små hjälpare ---
  const escapeHTML = (s)=>s.replace(/[&<>]/g,ch=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[ch]));
  function setBusy(on) {
    [createBtn, recBtn, saveBtn, clearBtn].forEach(b => b.disabled = on);
    createBtn.textContent = on ? 'Skapar saga…' : '✨ Skapa saga (med uppläsning)';
  }
  function show(msg, cls='info') {
    resultEl.innerHTML = `<div class="${cls}">${msg}</div>`;
  }
  function showStory(text) {
    resultEl.innerHTML = `<div class="story">${escapeHTML(text)}</div>`;
  }

  // --- Ålderspolicy: ordmängd + tonalitet ---
  function agePolicy(ageRange){
    switch(ageRange){
      case '1–2': return { min:50,  max:200,  tone:'rim, ljud, färger, enkel rytm' };
      case '3–4': return { min:180, max:350,  tone:'enkel handling, tydlig början och slut' };
      case '5–6': return { min:300, max:600,  tone:'lite mer komplex handling, problemlösning' };
      case '7–8': return { min:500, max:900,  tone:'äventyr, mysterier, humor' };
      case '9–10':return { min:800, max:1200, tone:'fantasy, vänskap, moraliska frågor' };
      case '11–12':return{ min:1000,max:1600, tone:'djupare teman, karaktärsutveckling' };
      default:     return { min:250, max:600,  tone:'barnvänlig' };
    }
  }

  // --- LocalStorage Hjältar ---
  const LS_KEY = 'bn_heroes';
  const loadHeroes = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)||'[]'); } catch { return []; } };
  const saveHeroName = (h) => {
    if (!h) return;
    const list = loadHeroes();
    if (!list.includes(h)) {
      list.push(h);
      localStorage.setItem(LS_KEY, JSON.stringify(list));
      show(`Hjälten <b>${escapeHTML(h)}</b> sparad.`, 'info');
    } else {
      show(`Hjälten <b>${escapeHTML(h)}</b> fanns redan.`, 'warnbox');
    }
  };
  const clearHeroes = () => { localStorage.removeItem(LS_KEY); show('Sparade hjältar rensade.'); };

  saveBtn.addEventListener('click', () => saveHeroName((heroEl.value||'').trim()));
  clearBtn.addEventListener('click', clearHeroes);

  // --- Nätverkshelpers ---
  async function apiJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',                     // Viktigt: POST – annars 405 på Functions
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(body || {})
    });
    let data;
    try { data = await res.json(); } catch { data = { ok:false, error:`${res.status} ${res.statusText}`}; }
    if (!data.ok) {
      const status = data.status || res.status;
      const msg = data.error || res.statusText || 'Okänt fel';
      throw new Error(`${status} ${msg}`);
    }
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
    return audioBase64; // data: URL enligt backend
  }

  async function generateStory(payload) {
    const { story } = await apiJSON('/api/generate_story', payload);
    return story;
  }

  // --- Inspelning (MediaRecorder) ---
  let mediaRecorder, chunks=[];
  recBtn.addEventListener('click', async () => {
    try {
      if (!mediaRecorder) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = e => chunks.push(e.data);
        mediaRecorder.onstop = async () => {
          const blob = new Blob(chunks, { type:'audio/webm' });
          chunks = [];
          try {
            setBusy(true);
            show('Bearbetar inspelningen…');
            const text = await transcribeBlob(blob);
            promptEl.value = text;
            show('Lokal inspelning klar. Texten är införd i rutan.');
          } catch (e) {
            show(`Kunde inte transkribera: ${e.message}`, 'error');
          } finally {
            setBusy(false);
          }
        };
      }
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        recBtn.textContent = '🎙️ Tala in';
      } else {
        chunks = [];
        mediaRecorder.start();
        recBtn.textContent = '⏹️ Stoppa inspelning';
        show('Spelar in… Klicka igen för att stoppa.');
      }
    } catch (e) {
      show(`Mikrofonfel: ${e.message}`, 'error');
    }
  });

  // --- Skapa saga + TTS ---
  createBtn.addEventListener('click', async () => {
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

      if (heroName) saveHeroName(heroName);

      showStory(story);

      // TTS direkt
      try {
        show('Skapar uppläsning…');
        const audioUrl = await tts(story);
        const audio = new Audio(audioUrl);
        await audio.play().catch(()=>{ /* autoplay kan blockas */ });
        show('Saga klar ✅ (uppläsning spelas upp)');
      } catch (e) {
        show(`Saga klar, men uppläsningen misslyckades: ${e.message}`, 'warnbox');
      }
    } catch (e) {
      show(`Misslyckades: ${e.message}`, 'error');
      // Specifik hint för 405:
      if (String(e.message).startsWith('405')) {
        show(
          'Misslyckades: 405 Method Not Allowed. Din serverfunktion för <b>/api/generate_story</b> accepterar troligen inte POST. '+
          'Kontrollera att <code>functions/api/generate_story.js</code> exporterar <code>onRequestPost</code>.',
          'error'
        );
      }
    } finally {
      setBusy(false);
    }
  });
});
