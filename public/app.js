// public/app.js
// Frontend glue for BN's Sagovärld (public folder).
// - Set API_BASE to your Worker URL (not the Pages URL) so POSTs hit the Worker.
// Replace the placeholder below with your Worker URL, e.g.:
// const API_BASE = "https://bn-worker.bjorta-bb.workers.dev";
const API_BASE = "https://<REPLACE-WITH-YOUR-WORKER-URL>";

// Helper shortcuts
const $ = (sel) => document.querySelector(sel);
const byId = (id) => document.getElementById(id);

const ENABLE_AGE_1_6 = false; // toggle client-side

function uuidv4() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random()*16|0, v = c=='x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}

function hideAge1to6Options() {
  if (ENABLE_AGE_1_6) return;
  const sel = byId('age');
  if (!sel) return;
  Array.from(sel.options).forEach(opt => {
    const t = (opt.text || '').toLowerCase().replace(/\s+/g,' ');
    if (/\b1 år\b|\b2 år\b|\b3|3–4|3-4|\b5-6\b|\b5–6\b|\b5 år\b|\b6 år\b/.test(t) || /(^|\b)(1|2|3|4|5|6)(\b|[^0-9])/.test(opt.value)) {
      try { opt.remove(); } catch(e) {}
    }
  });
  if (sel.options.length === 0) {
    const container = sel.closest('div') || sel.parentElement;
    if (container) container.style.display = 'none';
  } else {
    for (let i=0;i<sel.options.length;i++){
      const text = sel.options[i].text || sel.options[i].value;
      if (/\b7\b|\b8\b|\b9\b|\b10\b/.test(text)) { sel.selectedIndex = i; break; }
    }
  }
}

/* UI helpers */
function showSpinner(yes, statusText) {
  const spinner = document.querySelector('[data-id="spinner"]');
  const status = document.querySelector('[data-id="status"]');
  if (spinner) spinner.style.display = yes ? 'flex' : 'none';
  if (status && statusText) status.textContent = statusText;
}
function showError(msg) {
  const el = document.querySelector('[data-id="error"]');
  if (!el) return;
  el.style.display = msg ? 'block' : 'none';
  el.textContent = msg || '';
}
function setStoryText(text) {
  const el = document.querySelector('[data-id="story"]');
  if (el) el.textContent = text || '';
}

/* Create story: generate via /episodes/generate, then save as chapter via /api/chapter/save */
async function createStory() {
  showError('');
  const promptEl = document.querySelector('[data-id="prompt"]');
  const transcriptEl = document.querySelector('#transcript');
  const ageSel = document.querySelector('#age');
  const lengthSel = document.querySelector('#length');
  const heroInput = document.querySelector('#hero');

  const prompt = (promptEl && promptEl.value.trim()) || (transcriptEl && transcriptEl.value.trim());
  if (!prompt) { showError('Skriv en idé eller använd transkriptet innan du skapar saga.'); return; }

  let mins = 5;
  const len = lengthSel?.value || '';
  if (len === 'short') mins = 2;
  else if (len === 'medium') mins = 5;
  else if (len === 'long') mins = 12;
  else mins = 5;

  const lvl = 3;
  const lang = 'sv';
  const body = { lvl, mins, lang, prompt };

  try {
    showSpinner(true, 'Genererar berättelse…');
    // IMPORTANT: POST goes to Worker. Ensure API_BASE points to your Worker.
    const r = await fetch(`${API_BASE}/episodes/generate`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const txt = await r.text().catch(()=>'');
      throw new Error(`Generate failed: ${r.status} ${txt}`);
    }
    const data = await r.json();
    const text = data.text || '';
    setStoryText(text);

    const audioEl = document.querySelector('[data-id="audio"]');
    if (data.audio && data.audio.base64 && data.audio.format && audioEl) {
      audioEl.src = `data:audio/${data.audio.format};base64,${data.audio.base64}`;
    }

    let storyId = localStorage.getItem('bn_current_story');
    if (!storyId) { storyId = uuidv4(); localStorage.setItem('bn_current_story', storyId); }
    const title = (heroInput && heroInput.value.trim()) || prompt.split('\n')[0].slice(0,120) || 'Untitled';
    const payload = { story_id: storyId, title, chapter_index: 1, text };

    try {
      const saveR = await fetch(`${API_BASE}/api/chapter/save`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      const saveJ = await saveR.json().catch(()=>null);
      if (saveJ && saveJ.ok) {
        showSpinner(false);
        showError('');
        const statusEl = document.querySelector('[data-id="status"]');
        if (statusEl) statusEl.textContent = 'Berättelse skapad och sparad (kapitel 1).';
      } else {
        localStorage.setItem(`bn_localchapter_${storyId}_ch1`, JSON.stringify({ title, text, created_at: new Date().toISOString() }));
        showSpinner(false);
        showError('Berättelsen genererades men kunde inte sparas på servern — sparad lokalt.');
      }
    } catch (err) {
      localStorage.setItem(`bn_localchapter_${storyId}_ch1`, JSON.stringify({ title, text, created_at: new Date().toISOString() }));
      showSpinner(false);
      showError('Berättelsen genererades men ett nätverksfel uppstod vid sparning. Sparat lokalt.');
    }
  } catch (e) {
    showSpinner(false);
    showError(`Fel vid generering: ${e.message || e}`);
    console.warn(e);
  } finally {
    showSpinner(false);
  }
}

/* Play TTS via /api/tts/generate */
async function playTTS() {
  const text = (document.querySelector('[data-id="story"]')?.textContent || '').trim();
  if (!text) { showError('Ingen berättelse att läsa upp'); return; }
  showError('');
  showSpinner(true, 'Genererar tal…');
  try {
    const r = await fetch(`${API_BASE}/api/tts/generate`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ text })
    });
    if (!r.ok) {
      const t = await r.text().catch(()=>'');
      throw new Error(`TTS failed: ${r.status} ${t}`);
    }
    const buf = await r.arrayBuffer();
    const blob = new Blob([buf], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const audioEl = document.querySelector('[data-id="audio"]');
    if (audioEl) { audioEl.src = url; await audioEl.play().catch(()=>{}); }
    showSpinner(false, 'Uppspelning klar');
  } catch (e) {
    showSpinner(false);
    showError(`Fel vid TTS: ${e.message || e}`);
    console.warn(e);
  } finally {
    setTimeout(()=>showSpinner(false), 1200);
  }
}

/* Transcript and recorder hooks */
function hookTranscriptButtons() {
  const useBtn = document.getElementById('use-transcript');
  const clearBtn = document.getElementById('clear-transcript');
  const prompt = document.querySelector('[data-id="prompt"]');
  const transcript = document.getElementById('transcript');
  if (useBtn && transcript && prompt) {
    useBtn.addEventListener('click', () => { prompt.value = (transcript.value || '').trim(); });
  }
  if (clearBtn && transcript) { clearBtn.addEventListener('click', () => { transcript.value = ''; }); }
}

function hookRecorderControls() {
  const micBtn = byId('mic');
  const cancelBtn = byId('cancel');
  const recStatus = byId('rec-status');
  const recorderAPI = window.RecorderAPI || window.recorder || null;
  const hasStart = !!(recorderAPI?.start || window.startRecording || window.recorderStart);
  if (!micBtn) return;
  if (!hasStart) { micBtn.setAttribute('disabled','disabled'); micBtn.textContent = 'Inspelning ej tillgänglig'; return; }

  micBtn.addEventListener('click', async () => {
    try {
      if (recorderAPI && recorderAPI.running) {
        await (recorderAPI.stop?.() || recorderAPI.stopRecording?.());
        micBtn.textContent = 'Starta inspelning';
        recStatus.textContent = 'Inaktiv';
        if (cancelBtn) cancelBtn.style.display = 'none';
      } else {
        await (recorderAPI.start?.() || recorderAPI.startRecording?.() || window.startRecording?.());
        micBtn.textContent = 'Stoppa';
        recStatus.textContent = 'Spelar in…';
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
      }
    } catch (err) { console.warn('Recorder control error', err); showError('Kunde inte starta inspelning: ' + (err.message || err)); }
  });

  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      try { await (recorderAPI?.cancel?.() || recorderAPI?.stop?.() || window.stopRecording?.()); micBtn.textContent = 'Starta inspelning'; recStatus.textContent = 'Inaktiv'; cancelBtn.style.display = 'none'; } catch (e) { console.warn(e); }
    });
  }
}

/* Init bind */
window.addEventListener('DOMContentLoaded', () => {
  hideAge1to6Options();
  hookTranscriptButtons();
  hookRecorderControls();

  window.createStory = createStory;
  window.playTTS = playTTS;

  const createBtn = document.querySelector('[data-id="btn-create"]');
  const ttsBtn = document.querySelector('[data-id="btn-tts"]');
  if (createBtn) createBtn.addEventListener('click', (e)=>{ e.preventDefault(); createStory(); });
  if (ttsBtn) ttsBtn.addEventListener('click', (e)=>{ e.preventDefault(); playTTS(); });

  setTimeout(()=>{ fetch(`${API_BASE}/health`).catch(()=>{}); }, 300);

  showError('');
});
