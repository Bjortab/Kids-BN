// ---------- UI refs ----------
const childName = document.getElementById('childName');
const ageBand   = document.getElementById('ageBand');
const ageHint   = document.getElementById('ageHint');
const promptEl  = document.getElementById('prompt');

const btnRecord    = document.getElementById('btnRecord');
const chkWhisper   = document.getElementById('chkUseWhisper');
const chkMakeImgs  = document.getElementById('chkMakeImages');

const btnGenerate  = document.getElementById('btnGenerate');
const btnSaveHero  = document.getElementById('btnSaveHero');
const btnClear     = document.getElementById('btnClearHeroes');

const heroChips    = document.getElementById('heroChips');
const progress     = document.getElementById('progress');
const resultEl     = document.getElementById('result');
const audioEl      = document.getElementById('audio');

let mediaRecorder = null;
let chunks = [];
let activeHero = null;     // Chip som är vald
let lastStoryContext = null;

// ---------- Åldersguide ----------
const AGE_GUIDE = {
  '1-2': { mins:[1,3],  words:[80,220],   type:'Bilderbokskänsla med rim/ljud/upprepning',  tips:'Färger, djurläten, pek-svar', maxSentenceWords:8,  paragraphs:[3,5] },
  '3-4': { mins:[3,5],  words:[160,300],  type:'Enkla händelser med tydlig början och slut', tips:'Igenkänning, humor, frågor',   maxSentenceWords:12, paragraphs:[4,6] },
  '5-6': { mins:[5,10], words:[240,450],  type:'Lite mer komplex berättelse med ett problem', tips:'Små fantasiinslag',            maxSentenceWords:16, paragraphs:[5,7] },
  '7-8': { mins:[10,15],words:[400,650],  type:'Äventyr/mysterium med humor',                tips:'Serie-känsla, cliffhanger',   maxSentenceWords:18, paragraphs:[6,8] },
  '9-10':{ mins:[15,20],words:[550,900],  type:'Fantasy, vänskap, små moralfrågor',          tips:'Kapitelton',                   maxSentenceWords:22, paragraphs:[7,9] },
  '11-12':{mins:[20,30],words:[700,1200], type:'Djupare teman, enkel utveckling',            tips:'Högläsning funkar fint',       maxSentenceWords:24, paragraphs:[8,10] }
};
const FLAGS = { FORCE_CLEAR_MEMORY_BETWEEN_STORIES: true };

function updateAgeHint() {
  const g = AGE_GUIDE[ageBand.value];
  if (!g) return ageHint.textContent = '';
  ageHint.textContent = `mål: ${g.words[0]}–${g.words[1]} ord, ~${g.mins[0]}–${g.mins[1]} min`;
}
ageBand.addEventListener('change', updateAgeHint);
updateAgeHint();

function wordsTargetForAge(band){
  const g = AGE_GUIDE[band] || AGE_GUIDE['3-4'];
  return { min: g.words[0], max: g.words[1] };
}

function buildPrompt() {
  const name = (childName.value || 'Barnet').trim();
  const band = ageBand.value;
  const base = (promptEl.value || 'en snäll liten saga').trim();
  const guide = AGE_GUIDE[band] || AGE_GUIDE['3-4'];

  if (FLAGS.FORCE_CLEAR_MEMORY_BETWEEN_STORIES) lastStoryContext = null;

  const heroLine = activeHero
    ? `Hjälte att inkludera: ${activeHero.name}. Beskrivning: ${activeHero.description || activeHero.name}.`
    : 'Ingen hjälte vald — skapa en ny figur om det passar.';

  return `
Skriv en varm, trygg barnberättelse på svenska för åldersspannet ${band}.
Barnets namn: ${name}.
Högläsningstid: ~${guide.mins[0]}–${guide.mins[1]} min.
Målord: ${guide.words[0]}–${guide.words[1]}.
Typ av saga: ${guide.type}.
Berättartips: ${guide.tips}.
Språk: konkret och åldersanpassat. Max ${guide.maxSentenceWords} ord per mening.
Avstå från skräck, hot och mörker.

Sagognista från barnet: ${base}.
${heroLine}

Struktur:
- Titel på första raden, **fetstilt**
- ${guide.paragraphs[0]}–${guide.paragraphs[1]} korta stycken
- Vänlig, hoppfull avslutning som känns klar

Skriv sagan nu.
`.trim();
}

// ---------- Hjältar (lokalt galleri) ----------
const HERO_KEY = 'bn.heroes.v1';
function loadHeroes(){ try{ return JSON.parse(localStorage.getItem(HERO_KEY)||'[]'); }catch{ return []; } }
function saveHeroes(list){ localStorage.setItem(HERO_KEY, JSON.stringify(list)); }
function renderHeroChips(){
  heroChips.innerHTML = '';
  const heroes = loadHeroes();
  heroes.forEach(h=>{
    const el = document.createElement('div');
    el.className = 'chip' + (activeHero && activeHero.id===h.id ? ' active' : '');
    el.textContent = h.name;
    const x = document.createElement('span'); x.textContent='✕'; x.style.opacity=.6;
    x.style.marginLeft='6px'; x.style.cursor='pointer';
    x.addEventListener('click', (ev)=>{ ev.stopPropagation(); removeHero(h.id); });
    el.appendChild(x);
    el.addEventListener('click', ()=>{
      activeHero = activeHero && activeHero.id===h.id ? null : h;
      renderHeroChips();
    });
    heroChips.appendChild(el);
  });
}
function removeHero(id){
  const rest = loadHeroes().filter(h=>h.id!==id);
  if (activeHero && activeHero.id===id) activeHero=null;
  saveHeroes(rest); renderHeroChips();
}
function addHero(){
  const name = prompt('Hjältens namn? (t.ex. Draken Holger)');
  if (!name) return;
  const description = prompt('Kort beskrivning av hjälten (utseende/egenskaper), valfritt:') || '';
  const h = { id: crypto.randomUUID(), name: name.trim(), description: description.trim() };
  const list = loadHeroes(); list.push(h); saveHeroes(list);
  activeHero = h; renderHeroChips();
}
btnSaveHero.addEventListener('click', addHero);
btnClear.addEventListener('click', ()=>{
  if (confirm('Ta bort alla sparade hjältar?')) {
    localStorage.removeItem(HERO_KEY); activeHero=null; renderHeroChips();
  }
});
renderHeroChips();

// ---------- Inspelning & Whisper ----------
async function startRecording(){
  const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
  chunks = []; mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = e => { if (e.data.size>0) chunks.push(e.data); };
  mediaRecorder.onstop = async ()=>{
    const blob = new Blob(chunks, { type: 'audio/webm' });
    if (chkWhisper.checked){
      try{
        const fd = new FormData();
        fd.append('audio', blob, 'speech.webm');
        const res = await fetch('/api/whisper_transcribe', { method:'POST', body: fd });
        if (!res.ok) throw new Error('Whisper-fel');
        const data = await res.json(); // { text: "..." }
        promptEl.value = (data.text || '').trim();
      }catch(err){
        console.error(err);
        alert('Kunde inte tolka talet. Försök igen eller skriv text.');
      }
    }
    btnRecord.classList.remove('recording');
  };
  mediaRecorder.start(); btnRecord.classList.add('recording');
}
function stopRecording(){ if (mediaRecorder && mediaRecorder.state!=='inactive') mediaRecorder.stop(); }
let recToggling=false;
btnRecord.addEventListener('click', async ()=>{
  if (recToggling) return; recToggling=true;
  try{
    if (!mediaRecorder || mediaRecorder.state==='inactive') await startRecording();
    else stopRecording();
  } finally { recToggling=false; }
});

// ---------- Generera saga + TTS ----------
function setBusy(b){
  progress.classList.toggle('hidden', !b);
  btnGenerate.disabled = b; btnRecord.disabled = b; btnSaveHero.disabled = b; btnClear.disabled = b;
}
function renderStory(text){
  resultEl.innerHTML = text;
}
async function generate(){
  setBusy(true); audioEl.classList.add('hidden'); audioEl.src='';
  try{
    const payload = {
      prompt: buildPrompt(),
      childName: (childName.value||'').trim(),
      ageBand: ageBand.value,
      hero: activeHero ? { name: activeHero.name, description: activeHero.description||'' } : null,
      want_tts: true,
      want_images: !!chkMakeImgs.checked  // backend kan ignorera tills vi aktiverar
    };
    const res = await fetch('/api/generate_story', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    if (!res.ok){ 
      const t = await res.text(); throw new Error(`Serverfel ${res.status}: ${t}`); 
    }
    const data = await res.json(); // { story_html, audio_url? }
    renderStory(data.story_html || data.story || '—');
    if (data.audio_url){
      audioEl.src = data.audio_url; audioEl.classList.remove('hidden');
      // autoplay (kan blockas av browserpolicy)
      try{ await audioEl.play(); }catch{}
    }
  }catch(err){
    console.error(err);
    alert('Kunde inte skapa sagan. Kolla konsolen/loggarna.');
  }finally{ setBusy(false); }
}
btnGenerate.addEventListener('click', generate);

// Sätt ett startvärde för demo
if (!childName.value) childName.value = 'Lisa';
