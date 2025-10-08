// ------ DOM refs ------
const nameEl   = document.getElementById('child-name');
const ageEl    = document.getElementById('age');
const promptEl = document.getElementById('prompt');

const btnVoice      = document.getElementById('btn-voice');
const btnGen        = document.getElementById('btn-generate');
const btnTts        = document.getElementById('btn-tts');
const btnIll        = document.getElementById('btn-illustrate');
const btnSaveHero   = document.getElementById('btn-save-hero');

const voiceHint = document.getElementById('voice-hint');
const storyEl   = document.getElementById('story');
const playerEl  = document.getElementById('player');
const galleryEl = document.getElementById('gallery');
const heroesEl  = document.getElementById('heroes');

// ------ helpers ------
function notify(t){ alert(t); }
function lock(btn, on, label){
  btn.disabled = on;
  if (label) btn.textContent = on ? label : labelDefault(btn.id);
}
function labelDefault(id){
  switch(id){
    case 'btn-generate': return '✨ Skapa saga';
    case 'btn-tts': return '🔊 Läs upp';
    case 'btn-illustrate': return '🖼️ Illustrera';
    default: return '';
  }
}

// ------ Generate story ------
btnGen.addEventListener('click', generateStory);

async function generateStory() {
  const kidName = (nameEl.value || 'Vännen').trim();
  const ageGroup = ageEl.value || '3–5 år';
  const prompt = (promptEl.value || '').trim();

  if (!prompt) return notify("Skriv vad sagan ska handla om.");

  lock(btnGen, true, "Skapar saga…");
  try {
    const res = await fetch('/generate', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ prompt, kidName, ageGroup })
    });
    const data = await res.json().catch(()=> ({}));
    if (!res.ok) {
      notify(data?.error || `Fel (${res.status})`);
      return;
    }
    storyEl.textContent = data.story || '';
    playerEl.hidden = true;
    galleryEl.innerHTML = '';
    notify("Sagan är klar! 🎉");
  } catch(e) {
    console.error(e);
    notify("Tekniskt fel. Försök igen.");
  } finally {
    lock(btnGen, false, "Skapar saga…");
  }
}

// ------ TTS ------
btnTts.addEventListener('click', playTTS);

async function playTTS(){
  const text = (storyEl.textContent || '').trim();
  if (!text) return notify("Skapa en saga först.");
  lock(btnTts, true, "Skapar ljud…");
  try {
    const res = await fetch('/tts', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (!res.ok) return notify(data?.error || "Kunde inte skapa ljud.");
    const url = `/tts?id=${encodeURIComponent(data.id)}`;
    playerEl.src = url;
    playerEl.hidden = false;
    await playerEl.play().catch(()=>{});
  } catch(e){ console.error(e); notify("TTS fel."); }
  finally { lock(btnTts, false, "Skapar ljud…"); }
}

// ------ Illustrate ------
btnIll.addEventListener('click', illustrate);

async function illustrate(){
  const text = (storyEl.textContent || '').trim();
  if (!text) return notify("Skapa en saga först.");
  lock(btnIll, true, "Skapar bilder…");
  try {
    const res = await fetch('/illustrate_variations', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ prompt: text, count: 4 })
    });
    const data = await res.json();
    if (!res.ok) return notify(data?.error || "Kunde inte skapa bilder.");
    galleryEl.innerHTML = '';
    (data.items || []).forEach(it => {
      const img = document.createElement('img');
      img.src = `/art?id=${encodeURIComponent(it.key)}`;
      img.alt = 'illustration';
      galleryEl.appendChild(img);
    });
  } catch(e){ console.error(e); notify("Bildfel."); }
  finally { lock(btnIll, false, "Skapar bilder…"); }
}

// ------ Save hero (lokal demo: max 10) ------
btnSaveHero.addEventListener('click', ()=>{
  const kidName = (nameEl.value || 'Vännen').trim();
  const heroes = JSON.parse(localStorage.getItem('kidsbn_heroes') || '[]');
  if (heroes.length >= 10) return notify("Max 10 hjältar på Plus-planen.");
  heroes.push({ name: kidName, tagline: 'Barnets favorit', t: Date.now() });
  localStorage.setItem('kidsbn_heroes', JSON.stringify(heroes));
  renderHeroes();
  notify("Hjälten sparad! ⭐");
});

function renderHeroes(){
  const heroes = JSON.parse(localStorage.getItem('kidsbn_heroes') || '[]');
  heroesEl.innerHTML = heroes.length ? '' : '<span style="color:#a9b3c0">Inga sparade hjältar ännu.</span>';
  heroes.forEach(h=>{
    const div = document.createElement('div');
    div.className = 'story';
    div.textContent = `${h.name} — ${h.tagline || ''}`;
    heroesEl.appendChild(div);
  });
}
renderHeroes();

// ------ Voice input (Local STT / Whisper) ------
let isRec = false, mediaRecorder=null, chunks=[], speechRec=null, sttMode='local';
document.querySelectorAll('input[name="sttMode"]').forEach(r => r.addEventListener('change', e => sttMode=e.target.value));

btnVoice.addEventListener('click', async ()=>{
  if (!isRec){
    if (sttMode==='local') startLocalSTT();
    else await startWhisperRecord();
  } else {
    if (sttMode==='local') stopLocalSTT();
    else stopWhisperRecord();
  }
});

function setRec(on){
  isRec = on;
  btnVoice.classList.toggle('recording', on);
  btnVoice.querySelector('.mic-label').textContent = on ? 'Stoppa' : 'Tala in';
  voiceHint.textContent = on ? 'Spelar in… prata tydligt nära mikrofonen.' : '';
}

// Lokal STT
function startLocalSTT(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR){ voiceHint.textContent='Din webbläsare saknar lokal STT. Välj Whisper.'; return; }
  speechRec = new SR();
  speechRec.lang='sv-SE'; speechRec.continuous=true; speechRec.interimResults=true;
  setRec(true);
  let interim='';
  speechRec.onresult=(e)=>{
    let finalText='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      const tr = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += tr + ' ';
      else interim = tr;
    }
    promptEl.value = (promptEl.value + ' ' + finalText + ' ' + interim).trim();
  };
  speechRec.onerror=()=>{ voiceHint.textContent='Lokal STT fel.'; setRec(false); };
  speechRec.onend=()=> setRec(false);
  speechRec.start();
}
function stopLocalSTT(){ try{ speechRec && speechRec.stop(); }catch{} setRec(false); }

// Whisper STT
async function startWhisperRecord(){
  const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
  chunks=[]; mediaRecorder = new MediaRecorder(stream, { mimeType:'audio/webm' });
  mediaRecorder.ondataavailable = (e)=>{ if (e.data.size>0) chunks.push(e.data); };
  mediaRecorder.onstop = async ()=>{
    setRec(false); voiceHint.textContent='Transkriberar…';
    try{
      const blob = new Blob(chunks, { type:'audio/webm' });
      const fd = new FormData();
      fd.append('file', blob, 'speech.webm');
      fd.append('language','sv');
      const res = await fetch('/stt', { method:'POST', body: fd });
      const data = await res.json();
      const text = (data.text||'').trim();
      if (text) { promptEl.value = (promptEl.value ? promptEl.value+' ' : '') + text; voiceHint.textContent='Klart ✅'; }
      else voiceHint.textContent='Fick ingen text.';
    }catch(e){ console.error(e); voiceHint.textContent='Kunde inte transkribera.'; }
  };
  setRec(true);
  mediaRecorder.start();
  setTimeout(()=>{ if(isRec) stopWhisperRecord(); }, 45_000);
}
function stopWhisperRecord(){ try{ mediaRecorder && mediaRecorder.stop(); }catch{} setRec(false); }
