const el = (id) => document.getElementById(id);
const statusEl = el('status');
const storyEl  = el('story');
const audioEl  = el('audio');
const audioWrap= el('audioWrap');
const galEl    = el('gallery');
const heroesEl = el('heroes');

const allowedOrigin = window.location.origin; // används för enkel CORS-check i feltext

// --- UI helpers
function setStatus(msg, kind='info'){
  statusEl.classList.toggle('error', kind==='error');
  statusEl.textContent = msg || '';
}
function showAudio(src){
  if (!src) { audioWrap.classList.add('hidden'); return; }
  audioEl.src = src;
  audioWrap.classList.remove('hidden');
}
function addHeroPill(name){
  const span = document.createElement('span');
  span.className = 'hero-pill';
  span.textContent = name;
  heroesEl.appendChild(span);
}

// --- Microphone record (local or Whisper)
let mediaRec, chunks = [], isRecording = false;

async function toggleMic(){
  if (!isRecording){
    try{
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
      mediaRec = new MediaRecorder(stream);
      chunks = [];
      mediaRec.ondataavailable = (e)=>{ if (e.data.size>0) chunks.push(e.data); };
      mediaRec.onstop = async ()=>{
        const blob = new Blob(chunks, { type: 'audio/webm' });
        if (el('useWhisper').checked){
          setStatus('Transkriberar (Whisper)...');
          const fd = new FormData();
          fd.append('file', blob, 'speech.webm');
          const r = await fetch('/stt', { method:'POST', body:fd });
          if (!r.ok){ const t = await r.text(); setStatus('Whisper-fel: ' + t, 'error'); return; }
          const { text } = await r.json();
          el('prompt').value = text || '';
          setStatus('Transkribering klar.');
        } else {
          // lokal webspeech om tillgänglig
          setStatus('Lokal inspelning klar (läggs inte upp).');
        }
      };
      mediaRec.start();
      isRecording = true;
      el('btnMic').textContent = '⏹️ Stoppa';
      setStatus('Spelar in...');
    }catch(err){
      setStatus('Mikrofonfel: ' + err.message, 'error');
    }
  } else {
    mediaRec?.stop();
    isRecording = false;
    el('btnMic').textContent = '🎤 Tala in';
  }
}

// --- API calls
async function apiPOST(path, payload, isJSON=true){
  const headers = isJSON ? { 'Content-Type':'application/json' } : {};
  const res = await fetch(path, {
    method:'POST',
    headers,
    body: isJSON ? JSON.stringify(payload) : payload
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} ${res.status}: ${text}`);
  }
  return res.json();
}

// Generate story, then TTS, then optional images
async function onGenerate(){
  try{
    setStatus('Skapar saga...');
    galEl.innerHTML = '';
    showAudio(null);

    const name = el('childName').value.trim() || 'Vännen';
    const age  = el('age').value;
    const prompt = el('prompt').value.trim();

    const { story } = await apiPOST('/generate', { name, age, prompt });
    storyEl.textContent = story || '';
    setStatus('Sagan är klar. Skapar uppläsning...');

    const tts = await apiPOST('/tts', { text: story, childName: name, age });
    // tts: { id, url }  -> GET /tts?id=...
    showAudio(`/tts?id=${encodeURIComponent(tts.id)}`);

    if (el('optMakeImages').checked){
      setStatus('Skapar bilder...');
      const { images } = await apiPOST('/illustrate_variations', { prompt: `${name} ${age} ${prompt}`, count: 4 });
      galEl.innerHTML = '';
      images.forEach(url=>{
        const img = document.createElement('img');
        img.src = url;
        galEl.appendChild(img);
      });
      setStatus('Allt klart!');
    } else {
      setStatus('Allt klart!');
    }
  }catch(err){
    console.error(err);
    setStatus(err.message || 'Något gick fel', 'error');
  }
}

async function onTTS(){
  try{
    const text = storyEl.textContent.trim();
    if (!text){ setStatus('Ingen saga att läsa upp.', 'error'); return; }
    setStatus('Skapar uppläsning...');
    const name = el('childName').value.trim() || 'Vännen';
    const age  = el('age').value;
    const { id } = await apiPOST('/tts', { text, childName:name, age });
    showAudio(`/tts?id=${encodeURIComponent(id)}`);
    setStatus('Uppläsning klar.');
  }catch(err){
    console.error(err);
    setStatus(err.message, 'error');
  }
}

async function onIllustrate(){
  try{
    const prompt = el('prompt').value.trim();
    if (!prompt){ setStatus('Skriv/tala in en prompt först.', 'error'); return; }
    setStatus('Skapar bilder...');
    const { images } = await apiPOST('/illustrate_variations', { prompt, count: 4 });
    galEl.innerHTML = '';
    images.forEach(url=>{
      const img = document.createElement('img');
      img.src = url;
      galEl.appendChild(img);
    });
    setStatus('Bilder klara.');
  }catch(err){
    console.error(err);
    setStatus(err.message, 'error');
  }
}

function onSaveHero(){
  const name = el('childName').value.trim();
  if (!name){ setStatus('Ange ett namn först.', 'error'); return; }
  addHeroPill(name);
  setStatus('Hjälte sparad (lokalt minne).');
}

function onMerch(){
  setStatus('Merch kommer här: vi genererar variantbilder och skickar till vald POD-partner. (Stub)');
}

// wire up
window.addEventListener('DOMContentLoaded', ()=>{
  el('btnMic').addEventListener('click', toggleMic);
  el('btnGenerate').addEventListener('click', onGenerate);
  el('btnTTS').addEventListener('click', onTTS);
  el('btnIllustrate').addEventListener('click', onIllustrate);
  el('btnSaveHero').addEventListener('click', onSaveHero);
  el('btnMerch').addEventListener('click', onMerch);
});
