// ===== DOM =====
const $ = (id) => document.getElementById(id);

const nameInput   = $('childName');
const ageInput    = $('ageRange');
const promptEl    = $('prompt');
const heroInput   = $('heroName');

const btnSpeak    = $('btnSpeak');
const btnCreate   = $('btnCreate');
const btnSaveHero = $('btnSaveHero');
const btnReset    = $('btnResetHeroes');

const outBox      = $('result');
const statusLine  = $('statusText');

const setStatus = (msg) => { if (statusLine) statusLine.textContent = msg || ''; };
const showError = (msg) => { outBox.style.color = '#ff6b6b'; outBox.textContent = msg; };
const showStory = (txt) => { outBox.style.color = '#ffffff'; outBox.textContent = txt; };

// ===== Hjälpfunktioner =====
async function postJSON(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Prova flera endpoints i tur och ordning, returnera första OK-svaret
async function postTry(urls, body) {
  let lastErr;
  for (const u of urls) {
    try {
      const res = await postJSON(u, body);
      if (res.ok) return res;
      lastErr = new Error(`${u} → ${res.status}`);
      // 405/404? testa nästa
      if (res.status === 404 || res.status === 405) continue;
      // annan status: kasta direkt
      const txt = await res.text().catch(() => '');
      throw new Error(`${u} → ${res.status} ${txt}`);
    } catch (e) {
      lastErr = e;
      console.error('[postTry]', u, e);
    }
  }
  throw lastErr || new Error('Inget svar från servern.');
}

function attachAudioPlayerFromBlob(blob) {
  const old = document.getElementById('audioPlayer');
  if (old) old.remove();
  const url = URL.createObjectURL(blob);
  const audio = document.createElement('audio');
  audio.id = 'audioPlayer';
  audio.controls = true;
  audio.preload = 'auto';
  audio.src = url;
  outBox.insertAdjacentElement('afterend', audio);
  audio.play().catch(() => {});
}

async function handleTTSResponse(res) {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('audio/')) {
    const blob = await res.blob();
    attachAudioPlayerFromBlob(blob);
    return;
  }
  // prova JSON med base64
  let data = {};
  try { data = await res.json(); } catch {}
  if (data && data.audioBase64) {
    const bin = atob(data.audioBase64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    attachAudioPlayerFromBlob(new Blob([buf], { type: 'audio/mpeg' }));
    return;
  }
  throw new Error(data?.error || 'TTS gav inget ljud.');
}

// ===== Skapa saga + TTS =====
btnCreate?.addEventListener('click', async () => {
  try {
    btnCreate.disabled = true;
    const original = btnCreate.textContent;
    btnCreate.textContent = 'Skapar...';
    setStatus('Skapar saga...');

    const payload = {
      name:     (nameInput?.value || '').trim(),
      ageRange: (ageInput?.value || '').trim(),
      prompt:   (promptEl?.value || '').trim(),
      heroName: (heroInput?.value || '').trim(),
      quality:  'kids_v1'
    };

    if (!payload.prompt) {
      showError('Skriv vad sagan ska handla om först.');
      return;
    }

    // 1) STORY — prova båda rutterna
    const storyRes = await postTry(
      ['/api/generate_story', '/generate_story'],
      payload
    );

    // hämta JSON oavsett
    const storyData = await storyRes.json().catch(() => ({}));
    if (!storyData?.ok) throw new Error(storyData?.error || 'Kunde inte skapa sagan.');
    const story = storyData.story || '';
    if (!story) throw new Error('Tomt svar från generate_story.');

    showStory(story);
    setStatus('Skapar uppläsning...');

    // 2) TTS — prova båda rutterna
    const ttsRes = await postTry(
      ['/tts', '/api/tts'],
      { text: story } // lägg voiceId här om du använder ElevenLabs
    );

    await handleTTSResponse(ttsRes);
    setStatus('Klar!');

    // återställ knapptext
    btnCreate.textContent = original;
  } catch (err) {
    console.error('[create]', err);
    showError(String(err));
    setStatus('');
  } finally {
    btnCreate.disabled = false;
  }
});

// ===== Lokala hjältar =====
function loadHeroes() { try { return JSON.parse(localStorage.getItem('bn_heroes') || '[]'); } catch { return []; } }
function saveHeroes(list) { localStorage.setItem('bn_heroes', JSON.stringify(list)); }

btnSaveHero?.addEventListener('click', () => {
  const h = (heroInput?.value || '').trim();
  if (!h) return;
  const list = loadHeroes();
  if (!list.includes(h)) list.push(h);
  saveHeroes(list);
  setStatus(`Sparade hjälten “${h}”.`);
});

btnReset?.addEventListener('click', () => {
  saveHeroes([]);
  setStatus('Hjältar rensade.');
});

// ===== (Stubb) “Tala in” – lämnas orörd tills vi kopplar riktig inspelning =====
btnSpeak?.addEventListener('click', async () => {
  try {
    setStatus('Mikrofon – kommer snart (stub).');
  } catch (e) {
    showError(`Kunde inte spela in: ${String(e)}`);
  } finally {
    setStatus('');
  }
});

// Små UX-saker
;['input','change'].forEach(evt => {
  ageInput?.addEventListener(evt, () => setStatus(''));
  promptEl?.addEventListener(evt, () => setStatus(''));
  heroInput?.addEventListener(evt, () => setStatus(''));
  nameInput?.addEventListener(evt, () => setStatus(''));
});
