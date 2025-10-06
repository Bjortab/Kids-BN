// BN’s Sagovärld v1.5.1 – konto, kvoter, Stripe, TTS, merch-varianter, godnattmusik + lekfull loader

// === Config (fyll i) ===
const SUPABASE_URL = "DIN_SUPABASE_URL";
const SUPABASE_ANON_KEY = "DIN_SUPABASE_ANON_KEY";
const API_BASE = ""; // samma origin
const GENERATE_URL = `${API_BASE}/generate`;

// === Supabase init ===
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === UI refs ===
const ideaEl = document.getElementById("idea");
const micBtn = document.getElementById("micBtn");
const micStatus = document.getElementById("micStatus");
const generateBtn = document.getElementById("generateBtn");
const storyBox = document.getElementById("storyBox");
const voiceSelect = document.getElementById("voiceSelect");
const rateEl = document.getElementById("rate");
const speakBtn = document.getElementById("speakBtn");
const stopBtn = document.getElementById("stopBtn");
const modeBadge = document.getElementById("modeBadge");
const cooldownEl = document.getElementById("cooldown");
const errorMsg = document.getElementById("errorMsg");

const heroEl = document.getElementById("hero");
const fact1El = document.getElementById("fact1");
const fact2El = document.getElementById("fact2");
const fact3El = document.getElementById("fact3");
const saveMemBtn = document.getElementById("saveMemBtn");
const clearMemBtn = document.getElementById("clearMemBtn");
const memStatus = document.getElementById("memStatus");

const saveProfileBtn = document.getElementById("saveProfileBtn");
const profileNameEl = document.getElementById("profileName");
const saveProfileNamedBtn = document.getElementById("saveProfileNamedBtn");
const profilesList = document.getElementById("profilesList");
const profilesEmpty = document.getElementById("profilesEmpty");
const profileCount = document.getElementById("profileCount");

const userEmailEl = document.getElementById("userEmail");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");

const paywall = document.getElementById("paywall");
const quotaMsg = document.getElementById("quotaMsg");
const buyTokensBtn = document.getElementById("buyTokensBtn");
const subscribeBtn = document.getElementById("subscribeBtn");

const makeTtsBtn = document.getElementById("makeTtsBtn");
const downloadTtsLink = document.getElementById("downloadTtsLink");
const ttsMsg = document.getElementById("ttsMsg");

const merchBtn = document.getElementById("merchBtn");
const merchModal = document.getElementById("merchModal");
const closeMerchBtn = document.getElementById("closeMerchBtn");
const merchStatus = document.getElementById("merchStatus");
const variationsGrid = document.getElementById("variationsGrid");
const productStep = document.getElementById("productStep");
const createMerchBtn = document.getElementById("createMerchBtn");
const merchCheckoutMsg = document.getElementById("merchCheckoutMsg");
const productType = document.getElementById("productType");
const productColor = document.getElementById("productColor");
const productSize = document.getElementById("productSize");

// Sleep music
const playSleepBtn = document.getElementById("playSleepBtn");
const stopSleepBtn = document.getElementById("stopSleepBtn");
const sleepAudio = document.getElementById("sleepAudio");
const ageRange = document.getElementById("ageRange");

// Loader refs
const loaderOverlay = document.getElementById("loaderOverlay");
const loaderAnim = document.getElementById("loaderAnim");
const loaderPizza = document.getElementById("loaderPizza");
const loaderWheel = document.getElementById("loaderWheel");
const loaderBar = document.getElementById("loaderBar");
const loaderPct = document.getElementById("loaderPct");
const loaderMsg = document.getElementById("loaderMsg");
const pizzaRow = document.getElementById("pizzaRow");
const closeLoaderBtn = document.getElementById("closeLoaderBtn");

let loaderTimer=null, loaderProg=0, loaderHold=false;
function detectLoaderTheme(text){
  const s=(text||"").toLowerCase();
  if(/(drake|dragon)/.test(s)) return "dragon";
  if(/pizza/.test(s)) return "pizza";
  return "wheel";
}
function setupPizzaSlices(){ pizzaRow.innerHTML=""; for(let i=0;i<10;i++){const e=document.createElement("span");e.className="slice";e.textContent="🍕";pizzaRow.appendChild(e);} }
function setLoaderTheme(theme){
  loaderAnim.hidden = loaderPizza.hidden = loaderWheel.hidden = true;
  if(theme==="dragon") loaderAnim.hidden=false;
  else if(theme==="pizza"){ loaderPizza.hidden=false; setupPizzaSlices(); }
  else loaderWheel.hidden=false;
}
function showLoader(theme,msg){
  setLoaderTheme(theme||"wheel");
  loaderMsg.textContent = msg || "Magin startar strax…";
  loaderOverlay.style.display="flex";
  loaderProg=0; loaderHold=false; updateLoader(0);
  clearInterval(loaderTimer);
  loaderTimer=setInterval(()=>{
    if(loaderHold) return;
    const inc = loaderProg<60?2.5:loaderProg<85?1.2:0.4;
    loaderProg=Math.min(95, loaderProg+inc);
    updateLoader(loaderProg);
  },120);
}
function updateLoader(p){ loaderBar.style.width=`${p}%`; loaderPct.textContent=Math.floor(p); if(!loaderPizza.hidden){ const eat=Math.floor(p/10); [...pizzaRow.children].forEach((el,i)=>el.classList.toggle("eaten", i<eat)); } }
function completeLoader(){ loaderHold=true; updateLoader(100); setTimeout(hideLoader,350); }
function hideLoader(){ clearInterval(loaderTimer); loaderOverlay.style.display="none"; }
closeLoaderBtn?.addEventListener("click", hideLoader);

// === Mode HEAD ===
(async ()=>{
  try{
    const res = await fetch(GENERATE_URL, { method:"HEAD" });
    const mode = res.headers.get("x-kidsbn-mode") || "okänt";
    modeBadge.textContent = `Läge: ${mode}`;
    const live = mode === "live";
    modeBadge.style.background = live ? "#ecfdf5" : "#fffbeb";
    modeBadge.style.color = live ? "#065f46" : "#92400e";
  }catch{
    modeBadge.textContent = "Läge: offline (mock antas)";
    modeBadge.style.background="#fffbeb"; modeBadge.style.color="#92400e";
  }
})();

// === Auth ===
let currentUser = null;
let entitlement = { plan:"free", tokens_left:0, monthly_quota:8, used_this_month:0 };
window.__accessToken = null;

async function refreshAuthUI(){
  const { data:{ user } } = await supabase.auth.getUser();
  currentUser = user;
  if(user){
    userEmailEl.textContent = user.email;
    loginBtn.hidden = true; logoutBtn.hidden = false;
    window.__accessToken = (await supabase.auth.getSession()).data.session?.access_token;
    await refreshEntitlement();
  } else {
    userEmailEl.textContent = "Inte inloggad";
    loginBtn.hidden = false; logoutBtn.hidden = true;
    paywall.hidden = true;
  }
}
loginBtn.addEventListener("click", async ()=>{
  const email = prompt("Din e-post för magisk länk:");
  if(!email) return;
  const { error } = await supabase.auth.signInWithOtp({ email });
  if(error){ alert("Kunde inte skicka länk."); return; }
  alert("Kolla din e-post och klicka på länken för att logga in.");
});
logoutBtn.addEventListener("click", async ()=>{ await supabase.auth.signOut(); currentUser=null; window.__accessToken=null; await refreshAuthUI(); });
supabase.auth.onAuthStateChange(()=> refreshAuthUI());
refreshAuthUI();

async function refreshEntitlement(){
  const res = await fetch("/entitlement", { headers: window.__accessToken ? { "Authorization": `Bearer ${window.__accessToken}` } : {} });
  if(!res.ok){ paywall.hidden=false; quotaMsg.textContent="Logga in för att fortsätta."; return; }
  entitlement = await res.json();
  const remain = (entitlement.tokens_left||0) + Math.max(0, (entitlement.monthly_quota||0)-(entitlement.used_this_month||0));
  paywall.hidden = remain>0;
  if(!paywall.hidden) quotaMsg.textContent="Din kvot är slut. Välj paket eller abonnemang.";
}

// === TTS (web) ===
let voices=[];
function populateVoices(){
  voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  voiceSelect.innerHTML="";
  if(!voices.length){ const o=document.createElement("option"); o.value=""; o.textContent="Standard (system)"; voiceSelect.appendChild(o); return; }
  const sorted = voices.slice().sort((a,b)=>a.name.localeCompare(b.name));
  for(const v of sorted){ const o=document.createElement("option"); o.value=v.name; o.textContent=`${v.name} (${v.lang})`; voiceSelect.appendChild(o); }
  const pick = sorted.find(v=>["Swedish","sv-SE","Child","Female","Google","Microsoft"].some(p=>v.name.includes(p)||v.lang.includes(p)));
  if(pick) voiceSelect.value=pick.name;
}
if("speechSynthesis" in window){ populateVoices(); window.speechSynthesis.onvoiceschanged=populateVoices; } else { speakBtn.disabled=true; stopBtn.disabled=true; }
let currentUtterance=null;
speakBtn.addEventListener("click", ()=>{
  const text = storyBox.textContent.trim(); if(!text) return;
  if(currentUtterance) window.speechSynthesis.cancel();
  currentUtterance = new SpeechSynthesisUtterance(text);
  const sel = voices.find(v=>v.name===voiceSelect.value);
  if(sel) currentUtterance.voice=sel;
  currentUtterance.rate=Number(rateEl.value)||1;
  window.speechSynthesis.speak(currentUtterance);
});
stopBtn.addEventListener("click", ()=> window.speechSynthesis.cancel());

// === ASR (speech input) ===
let rec; let listening=false;
function setupRecognizer(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR) return null;
  const r = new SR();
  r.lang="sv-SE"; r.interimResults=true; r.continuous=false; r.maxAlternatives=1;
  r.onstart=()=>{ micStatus.textContent="Mikrofon: lyssnar…"; micBtn.setAttribute("aria-pressed","true"); };
  r.onend=()=>{ micStatus.textContent="Mikrofon: av"; micBtn.setAttribute("aria-pressed","false"); listening=false; };
  r.onerror=e=>{ micStatus.textContent=`Mikrofon fel: ${e.error}`; listening=false; };
  r.onresult=e=>{ let t=""; for(const res of e.results) t+=res[0].transcript; ideaEl.value=t; };
  return r;
}
rec = setupRecognizer();
micBtn.addEventListener("click", ()=>{ if(!rec){ alert("Taligenkänning stöds inte i denna webbläsare."); return; } if(listening){ rec.stop(); listening=false; return; } try{ rec.start(); listening=true; }catch{} });

// === Snällt minne (session) ===
const MEM_KEY = "kidsbn.memory.session.v1";
function loadMem(){ try{ const m=JSON.parse(sessionStorage.getItem(MEM_KEY)||"{}"); heroEl.value=m.hero||""; fact1El.value=m.facts?.[0]||""; fact2El.value=m.facts?.[1]||""; fact3El.value=m.facts?.[2]||""; }catch{} }
function getMemObj(){ const facts=[fact1El.value,fact2El.value,fact3El.value].map(s=>(s||"").trim()).filter(Boolean).slice(0,3); const hero=(heroEl.value||"").trim(); return { hero, facts }; }
function saveMem(){ const mem=getMemObj(); sessionStorage.setItem(MEM_KEY, JSON.stringify(mem)); memStatus.textContent="Sparat till denna flik!"; setTimeout(()=>memStatus.textContent="",1200); return mem; }
function clearMem(){ sessionStorage.removeItem(MEM_KEY); heroEl.value=fact1El.value=fact2El.value=fact3El.value=""; memStatus.textContent="Rensat (session)"; setTimeout(()=>memStatus.textContent="",1200); }
loadMem(); saveMemBtn.addEventListener("click", saveMem); clearMemBtn.addEventListener("click", clearMem);

// === Cooldown ===
const CD_COOKIE="kidsbn_cd";
function getCooldownLeft(){ const m=document.cookie.match(/(?:^|; )kidsbn_cd=([^;]+)/); if(!m) return 0; const until=Number(decodeURIComponent(m[1]))||0; return Math.max(0, until-Date.now()); }
function setCooldown(ms){ const until=Date.now()+ms; document.cookie=`${CD_COOKIE}=${encodeURIComponent(until)}; path=/; max-age=30`; }
function tickCooldown(){ const left=getCooldownLeft(); if(left>0){ cooldownEl.textContent=`Vänta ${Math.ceil(left/1000)} s…`; generateBtn.disabled=true; requestAnimationFrame(tickCooldown); } else { cooldownEl.textContent=""; generateBtn.disabled=false; } }
tickCooldown();

// === Favoritprofiler (lokal) ===
const MAX_PROFILES=5;
const PROFILES_KEY="kidsbn.profiles.v1";
function loadProfiles(){ try{ return JSON.parse(localStorage.getItem(PROFILES_KEY)||"[]"); }catch{ return []; } }
function saveProfiles(arr){ localStorage.setItem(PROFILES_KEY, JSON.stringify(arr)); renderProfiles(); }
function uid(){ return Math.random().toString(36).slice(2,10); }
function getLastStory(){ return (storyBox.textContent||"").trim(); }
function updateCountUI(len){ profileCount.textContent = `${len}/${MAX_PROFILES}`; }
function createProfile(name){ const profiles=loadProfiles(); if(profiles.length>=MAX_PROFILES){ alert(`Max ${MAX_PROFILES} profiler. Radera en för att spara ny.`); return; } const now=new Date().toISOString(); const mem=getMemObj(); const p={ id:uid(), name:(name||mem.hero||"Min hjälte").slice(0,60), hero:mem.hero, facts:mem.facts, lastStory:getLastStory(), createdAt:now, updatedAt:now }; profiles.push(p); saveProfiles(profiles); }
function renameProfile(id,n){ const arr=loadProfiles(); const p=arr.find(x=>x.id===id); if(!p) return; p.name=(n||p.name).slice(0,60); p.updatedAt=new Date().toISOString(); saveProfiles(arr); }
function deleteProfile(id){ const arr=loadProfiles().filter(x=>x.id!==id); saveProfiles(arr); }
function applyProfile(id,alsoStory=false){ const p=loadProfiles().find(x=>x.id===id); if(!p) return; heroEl.value=p.hero||""; fact1El.value=p.facts?.[0]||""; fact2El.value=p.facts?.[1]||""; fact3El.value=p.facts?.[2]||""; saveMem(); if(alsoStory && p.lastStory) storyBox.textContent=p.lastStory; ideaEl.focus(); }
function attachStoryToProfile(id){ const arr=loadProfiles(); const p=arr.find(x=>x.id===id); if(!p) return; p.lastStory=getLastStory(); p.updatedAt=new Date().toISOString(); saveProfiles(arr); }
function renderProfiles(){
  const profiles=loadProfiles(); profilesEmpty.style.display=profiles.length?"none":"block"; profilesList.innerHTML=""; updateCountUI(profiles.length);
  for(const p of profiles){
    const li=document.createElement("li"); li.className="profile-card";
    const head=document.createElement("div"); head.className="profile-head";
    const nameEl=document.createElement("span"); nameEl.className="profile-name"; nameEl.textContent=p.name;
    const meta=document.createElement("span"); meta.className="profile-meta"; meta.textContent=p.hero?`Hjälte: ${p.hero}`:"Hjälte: –";
    head.append(nameEl,meta);
    const acts=document.createElement("div"); acts.className="profile-actions";
    const b1=document.createElement("button"); b1.className="btn"; b1.textContent="📥 Ladda hjälte"; b1.onclick=()=>applyProfile(p.id,false);
    const b2=document.createElement("button"); b2.className="btn"; b2.textContent="📚 Ladda hjälte + saga"; b2.onclick=()=>applyProfile(p.id,true);
    const b3=document.createElement("button"); b3.className="btn"; b3.textContent="💾 Spara aktuell saga"; b3.onclick=()=>attachStoryToProfile(p.id);
    const b4=document.createElement("button"); b4.className="btn"; b4.textContent="✏️ Byt namn"; b4.onclick=()=>{ const n=prompt("Nytt namn för profilen:", p.name); if(n!==null && n.trim()) renameProfile(p.id,n.trim()); };
    const b5=document.createElement("button"); b5.className="btn secondary"; b5.textContent="🗑 Radera"; b5.onclick=()=>{ if(confirm("Radera profilen?")) deleteProfile(p.id); };
    acts.append(b1,b2,b3,b4,b5);
    li.append(head,acts);
    if(p.facts?.length){ const f=document.createElement("div"); f.className="profile-meta"; f.textContent="Fakta: "+p.facts.join(" • "); li.appendChild(f); }
    if(p.lastStory){ const l=document.createElement("div"); l.className="profile-meta"; l.textContent="Har sparad saga ✔︎"; li.appendChild(l); }
    profilesList.appendChild(li);
  }
}
renderProfiles();
saveProfileBtn.addEventListener("click", ()=>createProfile(""));
saveProfileNamedBtn.addEventListener("click", ()=>{ const n=(profileNameEl.value||"").trim(); createProfile(n); profileNameEl.value=""; });

// === Entitlement Checkout ===
buyTokensBtn.addEventListener("click", async ()=>{
  const res = await fetch("/billing_checkout", {
    method:"POST",
    headers: { "Content-Type":"application/json", ...(window.__accessToken?{ "Authorization":`Bearer ${window.__accessToken}` }:{}) },
    body: JSON.stringify({ product:"tokens20" })
  });
  const data = await res.json(); if(data.url) window.location.href=data.url;
});
subscribeBtn.addEventListener("click", async ()=>{
  const res = await fetch("/billing_checkout", {
    method:"POST",
    headers: { "Content-Type":"application/json", ...(window.__accessToken?{ "Authorization":`Bearer ${window.__accessToken}` }:{}) },
    body: JSON.stringify({ product:"sub_plus" })
  });
  const data = await res.json(); if(data.url) window.location.href=data.url;
});

// === Generera saga (med loader + kvot) ===
function showError(msg){ errorMsg.hidden=false; errorMsg.textContent=msg; }
function clearError(){ errorMsg.hidden=true; errorMsg.textContent=""; }

generateBtn.addEventListener("click", async ()=>{
  clearError();
  if(!currentUser){ alert("Logga in först."); return; }
  const left = getCooldownLeft(); if(left>0){ tickCooldown(); return; }
  const prompt = (ideaEl.value||"").trim(); if(!prompt){ showError("Skriv eller prata in vad sagan ska handla om."); return; }

  const mem = saveMem();
  generateBtn.disabled=true; generateBtn.textContent="⏳ Skapar..."; storyBox.textContent="";
  showLoader(detectLoaderTheme(prompt),"Skriver din saga…");

  try{
    const res = await fetch(GENERATE_URL, {
      method:"POST",
      headers: { "Content-Type":"application/json", ...(window.__accessToken?{ "Authorization":`Bearer ${window.__accessToken}` }:{}) },
      body: JSON.stringify({ prompt, memory: mem })
    });
    if(!res.ok){
      if(res.status===402){ hideLoader(); paywall.hidden=false; quotaMsg.textContent="Kvoten är slut. Välj paket eller abonnemang."; return; }
      const t=await res.text(); throw new Error(t||`Serverfel (${res.status})`);
    }
    const data = await res.json();
    storyBox.textContent = data.story || "Ingen saga returnerades.";
    setCooldown(5000);
  }catch(err){
    console.error(err); showError("Kunde inte skapa sagan just nu. Testa igen strax.");
  }finally{
    generateBtn.disabled=false; generateBtn.textContent="✨ Generera saga"; tickCooldown(); completeLoader();
  }
});

// === Server-TTS ===
makeTtsBtn.addEventListener("click", async ()=>{
  ttsMsg.hidden=true; downloadTtsLink.hidden=true;
  const text=(storyBox.textContent||"").trim(); if(!text){ ttsMsg.hidden=false; ttsMsg.textContent="Ingen saga att läsa in ännu."; return; }
  makeTtsBtn.disabled=true; makeTtsBtn.textContent="⏳ Skapar ljud...";
  try{
    const res=await fetch("/tts",{ method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ text, voice:"kids_friendly" }) });
    if(res.status===501){ ttsMsg.hidden=false; ttsMsg.textContent="Server-TTS ej aktiverad. Använd ▶️ Spela upp, eller lägg in ELEVENLABS_API_KEY för MP3."; return; }
    if(!res.ok){ const t=await res.text().catch(()=> ""); throw new Error(t||"TTS-fel"); }
    const { id } = await res.json();
    downloadTtsLink.href=`/tts?id=${encodeURIComponent(id)}`; downloadTtsLink.hidden=false; ttsMsg.hidden=false; ttsMsg.textContent="Klar! Klicka 'Hämta MP3' för att ladda ner.";
  }catch(e){ console.error(e); ttsMsg.hidden=false; ttsMsg.textContent="Kunde inte skapa ljud nu. Prova igen eller använd ▶️."; }
  finally{ makeTtsBtn.disabled=false; makeTtsBtn.textContent="🎧 Skapa ljudfil"; }
});

// === Merch (variationer + create) ===
let selectedVariationId=null, currentMerchJob=null;
function openMerch(){ merchModal.style.display="block"; }
function closeMerch(){ merchModal.style.display="none"; variationsGrid.innerHTML=""; productStep.style.display="none"; selectedVariationId=null; merchCheckoutMsg.textContent=""; }
closeMerchBtn.addEventListener("click", closeMerch);

merchBtn.addEventListener("click", async ()=>{
  if(!currentUser){ alert("Logga in först för att skapa merch."); return; }
  const story=(storyBox.textContent||"").trim(); if(!story){ alert("Skapa en saga först."); return; }
  openMerch(); merchStatus.textContent="Genererar varianter…"; variationsGrid.innerHTML=""; productStep.style.display="none"; selectedVariationId=null;
  showLoader(detectLoaderTheme(ideaEl.value||"drake"), "Målar din drake…");

  const heroName=(heroEl.value||"En snäll drake").trim();
  const idea=(ideaEl.value||"").trim();
  const desc=`${heroName}. Stil: akvarell, mjuka färger, barnvänlig, leende. Motiv från sagan: ${idea.slice(0,160)}`;

  try{
    const res=await fetch("/illustrate_variations",{
      method:"POST",
      headers:{ "Content-Type":"application/json", ...(window.__accessToken?{ "Authorization":`Bearer ${window.__accessToken}` }:{}) },
      body:JSON.stringify({ hero_desc:desc, n:4 })
    });
    if(!res.ok){ merchStatus.textContent="Kunde inte generera bilder just nu."; hideLoader(); return; }
    const data=await res.json(); currentMerchJob=data.job_id; merchStatus.textContent="Välj din favoritdrake:";
    for(const v of data.variations){
      const img=document.createElement("img"); img.src=v.url; img.alt="Drak-variation"; img.style.width="100%"; img.style.border="3px solid transparent"; img.style.borderRadius="10px"; img.style.cursor="pointer";
      img.onclick=()=>{ [...variationsGrid.querySelectorAll("img")].forEach(el=>el.style.border="3px solid transparent"); img.style.border="3px solid #7c3aed"; selectedVariationId=v.id; productStep.style.display="block"; };
      variationsGrid.appendChild(img);
    }
  }catch(e){ merchStatus.textContent="Nätverksfel."; }
  finally{ completeLoader(); }
});

createMerchBtn.addEventListener("click", async ()=>{
  if(!selectedVariationId){ alert("Välj först en drake."); return; }
  merchCheckoutMsg.textContent="Skapar produkt…";
  try{
    const res=await fetch("/merch_create",{
      method:"POST",
      headers:{ "Content-Type":"application/json", ...(window.__accessToken?{ "Authorization":`Bearer ${window.__accessToken}` }:{}) },
      body:JSON.stringify({ job_id:currentMerchJob, variation_id:selectedVariationId, product:{ type:productType.value, color:productColor.value, size:productSize.value } })
    });
    if(!res.ok){ merchCheckoutMsg.textContent="Kunde inte skapa produkten just nu."; return; }
    const data=await res.json();
    if(data.checkout_url){ merchCheckoutMsg.innerHTML=`Klar! <a href="${data.checkout_url}" target="_blank" rel="noopener">Öppna checkout</a>`; } else { merchCheckoutMsg.textContent="Produkt skapad (test-läge)."; }
  }catch(e){ merchCheckoutMsg.textContent="Nätverksfel."; }
});

// === Godnattmusik – fyll dessa med dina R2-länkar ===
const sleepTracks = {
  "0-1": ["https://cdn.example.com/audio/baby_dreams.mp3"],
  "2-4": ["https://cdn.example.com/audio/tiny_forest.mp3"],
  "5-7": ["https://cdn.example.com/audio/star_drift.mp3"],
  "8-10": ["https://cdn.example.com/audio/moon_journey.mp3"]
};
playSleepBtn.addEventListener("click", () => {
  const sel = ageRange.value;
  const arr = sleepTracks[sel] || [];
  if(!arr.length){ alert("Ingen musik tillagd än."); return; }
  const pick = arr[Math.floor(Math.random()*arr.length)];
  sleepAudio.src = pick;
  sleepAudio.loop = true;
  sleepAudio.play();
});
stopSleepBtn.addEventListener("click", ()=> {
  sleepAudio.pause();
  sleepAudio.currentTime = 0;
});
