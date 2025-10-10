// public/app.js

const $ = (sel) => document.querySelector(sel);
const nameEl = $('#childName');
const ageEl = $('#ageRange');
const promptEl = $('#prompt');
const heroEl = $('#heroName');
const resultEl = $('#result');
const recBtn = $('#btnRecord');
const createBtn = $('#btnCreate');

let mediaRecorder;
let chunks = [];

// UI helpers
function setBusy(on) {
  createBtn.disabled = on;
  recBtn.disabled = on;
  createBtn.textContent = on ? 'Skapar saga…' : 'Skapa saga (med uppläsning)';
}

function showError(msg) {
  resultEl.innerHTML = `<div class="error">${msg}</div>`;
}
function showStory(text) {
  resultEl.innerHTML = `<div class="story"><pre>${text}</pre></div>`;
}
function playAudio(dataUrl) {
  const a = new Audio(dataUrl);
  a.play().catch(()=>{});
}

// ----- Transcribe (Whisper) -----
async function transcribeBlob(blob) {
  const fd = new FormData();
  fd.append('audio', blob, 'recording.webm');
  const res = await fetch('/api/whisper_transcribe', { method: 'POST', body: fd });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Transkribering misslyckades');
  return data.text || '';
}

// ----- Generate story -----
async function generateStory({ name, ageRange, prompt, heroName }) {
  const res = await fetch('/api/generate_story', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ageRange, prompt, heroName })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Kunde inte skapa saga');
  return data.story || '';
}

// ----- TTS -----
async function tts(text) {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'TTS misslyckades');
  return data.audioBase64; // data URL
}

// ====== UI: Record button ======
recBtn?.addEventListener('click', async () => {
  try {
    if (!mediaRecorder) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        chunks = [];
        try {
          setBusy(true);
          const text = await transcribeBlob(blob);
          promptEl.value = text;
          showError('Lokal inspelning klar (texten är införd i rutan).');
        } catch (e) {
          showError(`Kunde inte transkribera: ${e.message}`);
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
    }
  } catch (e) {
    showError(`Mikrofonfel: ${e.message}`);
  }
});

// ====== UI: Create story button ======
createBtn?.addEventListener('click', async () => {
  const name = (nameEl.value || '').trim();
  const ageRange = ageEl.value;
  const prompt = (promptEl.value || '').trim();
  const heroName = (heroEl.value || '').trim() || null;

  if (!name || !prompt) {
    showError('Fyll i barnets namn och en kort beskrivning (sagognist).');
    return;
  }

  try {
    setBusy(true);
    const story = await generateStory({ name, ageRange, prompt, heroName });
    showStory(story);

    // Generera uppläsning direkt
    try {
      const audioUrl = await tts(story);
      playAudio(audioUrl);
    } catch (e) {
      showError(`Saga klar men TTS misslyckades: ${e.message}`);
    }

  } catch (e) {
    showError(`Misslyckades: ${e.message}`);
  } finally {
    setBusy(false);
  }
});
