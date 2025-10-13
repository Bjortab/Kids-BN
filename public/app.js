// ===== DOM =====
const el = (id) => document.getElementById(id);

const nameInput   = el('childName');     // Barnets namn (text)
const ageInput    = el('ageRange');      // Ålder ex. "1–2"
const promptEl    = el('prompt');        // Sagognista (textarea)
const heroInput   = el('heroName');      // Hjältens namn (valfritt)

const btnSpeak    = el('btnSpeak');      // "Tala in"
const btnCreate   = el('btnCreate');     // "Skapa saga (med uppläsning)"
const btnSaveHero = el('btnSaveHero');   // "Spara hjälte"
const btnReset    = el('btnResetHeroes');// "Rensa hjältar"

const outBox      = el('result');        // Rutan där sagan visas
const statusLine  = el('statusText');    // (valfritt) litet statusmeddelande

// Litet hjälp-UI
const setStatus = (msg) => { if (statusLine) statusLine.textContent = msg || ''; };
const showError = (msg) => {
  outBox.style.color = '#ff6b6b';
  outBox.textContent = msg;
};
const showStory = (txt) => {
  outBox.style.color = '#ffffff';
  outBox.textContent = txt;
};

// ===== Hjälpfunktioner =====
async function postJSON(url, body, extraHeaders = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
  return res;
}

// Skapar/byter ut en <audio> under resultatrutan
function attachAudioPlayerFromBlob(blob) {
  // Ta bort ev. tidigare spelare
  const old = document.getElementById('audioPlayer');
  if (old) old.remove();

  const url = URL.createObjectURL(blob);
  const audio = document.createElement('audio');
  audio.id = 'audioPlayer';
  audio.controls = true;
  audio.preload = 'auto';
  audio.src = url;

  // Lägg den efter texten
  outBox.insertAdjacentElement('afterend', audio);

  // Autoplay (tillåts oftast efter user-gesture)
  audio.play().catch(() => {
    // Om autoplay blockas: det finns i alla fall en spelare synlig
  });
}

// Fångar både audio/mpeg-stream och JSON med base64
async function handleTTSResponse(res) {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('audio/')) {
    const blob = await res.blob();
    attachAudioPlayerFromBlob(blob);
    return;
  }
  const data = await res.json().catch(() => ({}));
  if (data?.audioBase64) {
    const bin = atob(data.audioBase64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    attachAudioPlayerFromBlob(new Blob([bytes], { type: 'audio/mpeg' }));
    return;
  }
  throw new Error(data?.error || 'TTS gav inget ljud.');
}

// ===== Skapa saga + uppläsning =====
btnCreate?.addEventListener('click', async () => {
  try {
    // Lås knappen
    btnCreate.disabled = true;
    const originalLabel = btnCreate.textContent;
    btnCreate.textContent = 'Skapar...';
    setStatus('Skapar saga...');

    const payload = {
      name:     (nameInput?.value || '').trim(),
      ageRange: (ageInput?.value || '').trim(),   // ex. "1–2"
      prompt:   (promptEl?.value || '').trim(),
      heroName: (heroInput?.value || '').trim(),
      // Liten flagga till backend att vi vill ha extra strikt kvalitet (kan ignoreras om inte implementerat)
      quality:  'kids_v1'
    };

    if (!payload.prompt) {
      showError('Skriv vad sagan ska handla om först.');
      return;
    }

    // 1) Skapa sagan
    const storyRes = await postJSON('/api/generate_story', payload);
    const storyData = await storyRes.json().catch(() => ({}));

    if (!storyRes.ok || !storyData?.ok) {
      throw new Error(storyData?.error || `Serverfel (story): ${storyRes.status}`);
    }

    const story = storyData.story || '';
    if (!story) throw new Error('Tomt svar från generate_story.');
    showStory(story);
    setStatus('Skapar uppläsning...');

    // 2) TTS
    // Om ditt /tts förväntar sig { text, voiceId } – byt fieldnamn här.
    const ttsRes = await postJSON('/tts', {
      text: story,
      // Skicka med valfritt röst-id om du använder ElevenLabs:
      // voiceId: 'din_röst_id'
    });

    if (!ttsRes.ok) {
      // Försök få ev JSON-fel från servern
      let msg = `Serverfel (tts): ${ttsRes.status}`;
      try {
        const errJ = await ttsRes.json();
        if (errJ?.error) msg = errJ.error;
      } catch {}
      throw new Error(msg);
    }

    await handleTTSResponse(ttsRes);
    setStatus('Klar!');
  } catch (err) {
    showError(String(err));
    setStatus('');
  } finally {
    if (btnCreate) {
      btnCreate.disabled = false;
      btnCreate.textContent = '✨ Skapa saga (med uppläsning)';
    }
  }
});

// ===== Spara/Rensa hjältar (lokalt i browsern) =====
function loadHeroes() {
  try {
    return JSON.parse(localStorage.getItem('bn_heroes') || '[]');
  } catch { return []; }
}
function saveHeroes(list) {
  localStorage.setItem('bn_heroes', JSON.stringify(list));
}
btnSaveHero?.addEventListener('click', () => {
  const h = (heroInput?.value || '').trim();
  if (!h) return;
  const list = loadHeroes();
  if (!list.includes(h)) {
    list.push(h);
    saveHeroes(list);
    setStatus(`Sparade hjälten “${h}”.`);
  }
});
btnReset?.addEventListener('click', () => {
  saveHeroes([]);
  setStatus('Hjältar rensade.');
});

// ===== (Frivilligt) Tala in – stubb för inspelning till /whisper_transcribe =====
// Behålls för kompatibilitet. Du kan komplettera med riktig inspelning senare.
btnSpeak?.addEventListener('click', async () => {
  try {
    setStatus('Mikrofon-inspelning (stub)…');
    // Implementera WebAudio/MediaRecorder här om du vill.
    // När du har en Blob: skicka FormData till /whisper_transcribe och fyll promptEl.value = text
    // Den här stubbens poäng är att inte krascha UI om knappen finns.
  } catch (e) {
    showError(`Kunde inte spela in: ${String(e)}`);
  } finally {
    setStatus('');
  }
});

// ===== Små UX-detaljer =====
;['input','change'].forEach(evt => {
  ageInput?.addEventListener(evt, () => setStatus(''));
  promptEl?.addEventListener(evt, () => setStatus(''));
  heroInput?.addEventListener(evt, () => setStatus(''));
  nameInput?.addEventListener(evt, () => setStatus(''));
});
