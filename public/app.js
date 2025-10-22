// public/app.js — matchad till /functions/tts.js (Google TTS)
// - "Skapa saga + uppläsning" skapar ny text + nytt ljud (reuse:false)
// - "Spela igen" återanvänder cachen för exakt samma text (reuse:true)
// - Visar X-Tts-Cache HIT/MISS i en badge
// - Spinner stängs alltid korrekt
// - Lämnar övriga endpoints orörda (generate_story etc)

const $ = id => document.getElementById(id);
const ui = {
  age: $("age"),
  hero: $("hero"),
  prompt: $("prompt"),
  voice: $("voice"),
  rate: $("rate"),
  pitch: $("pitch"),

  btnTalk: $("btnTalk"),
  btnMake: $("btnMake"),
  btnReplay: $("btnReplay"),

  spinner: $("spinner"),
  err: $("err"),

  story: $("story"),
  player: $("player"),
  playerWrap: $("playerWrap"),
  cacheBadge: $("cacheBadge")
};

// ===== Spinner & error =====
function setBusy(b){ ui.spinner.style.display = b ? "inline-flex" : "none"; }
function showErr(msg){ ui.err.style.display="block"; ui.err.textContent = msg; }
function clearErr(){ ui.err.style.display="none"; ui.err.textContent = ""; }
function setCacheBadge(v){ if(!v){ ui.cacheBadge.style.display="none"; return; } ui.cacheBadge.textContent=`Cache: ${v}`; ui.cacheBadge.style.display="inline-block"; }

// ===== Ålderskontroller (för generate_story, ändrar INTE backenden) =====
function ageToControls(age){
  switch(age){
    case '1–2 år':  return { minChars:60, maxChars:90,  minWords:8,  maxWords:20,  chapters:1, styleHint:'pekbok; mycket korta meningar; ljudord; [BYT SIDA] mellan meningar vid behov' };
    case '3–4 år':  return { minWords:80,  maxWords:160, chapters:1, styleHint:'korta meningar; 3–5 scener; humor; naturligt slut' };
    case '5–6 år':  return { minWords:180, maxWords:320, chapters:1, styleHint:'problem–lösning; varm ton; naturligt slut (inga mallfraser)' };
    case '7–8 år':  return { minWords:350, maxWords:600, chapters:1, styleHint:'äventyr; tydliga val; varierade scener; naturligt slut' };
    case '9–10 år': return { minWords:500, maxWords:900, chapters:2, styleHint:'tempo + känsla; miljö utan svåra ord' };
    case '11–12 år':return { minWords:700, maxWords:1200,chapters:2, styleHint:'spänning; smart problemlösning; respektfull ton' };
    default:        return { minWords:200, maxWords:400, chapters:1, styleHint:'barnvänlig' };
  }
}

// ===== Skapa saga =====
ui.btnMake.addEventListener("click", async ()=>{
  clearErr(); setBusy(true); setCacheBadge(null);
  try{
    const prompt = ui.prompt.value.trim();
    if(!prompt) throw new Error("Skriv eller tala in något först.");

    const controls = ageToControls(ui.age.value);

    // Primär endpoint: /api/generate_story (lämnas orörd i backend)
    const storyRes = await fetch("/api/generate_story", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({
        prompt,
        age: ui.age.value,
        heroName: ui.hero.value.trim(),
        controls,
        read_aloud:false
      })
    });

    if(!storyRes.ok){
      const t = await storyRes.text().catch(()=> "");
      throw new Error(`Story: ${storyRes.status}\n${t.slice(0,400)}`);
    }
    const storyData = await storyRes.json();
    const storyText = storyData.story || "";
    if(!storyText) throw new Error("Fick ingen text tillbaka.");

    ui.story.textContent = storyText;

    // Direkt talsyntes (reuse:false => ny version, cache stör ej)
    await speak(storyText, { reuse:false });

  } catch(err){
    showErr(err.message || String(err));
  } finally {
    setBusy(false);
  }
});

// ===== Spela igen (återanvänd cache om samma text) =====
ui.btnReplay.addEventListener("click", async ()=>{
  clearErr(); setBusy(true);
  try{
    const txt = ui.story.textContent.trim();
    if(!txt) throw new Error("Det finns ingen saga att spela upp igen.");
    await speak(txt, { reuse:true });
  } catch(err){
    showErr(err.message || String(err));
  } finally {
    setBusy(false);
  }
});

// ===== TTS (Google worker) =====
async function speak(text, { reuse=false } = {}){
  const body = {
    text,
    reuse,
    voice: (ui.voice.value || "").trim() || undefined,
    languageCode: "sv-SE"
  };

  const sr = parseFloat(ui.rate.value || "");
  const pt = parseFloat(ui.pitch.value || "");
  if(!Number.isNaN(sr)) body.speakingRate = sr;
  if(!Number.isNaN(pt)) body.pitch = pt;

  const res = await fetch("/tts", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });

  const ct = (res.headers.get("Content-Type") || "").toLowerCase();
  if(!res.ok){
    let msg = `TTS: ${res.status}`;
    if(ct.includes("application/json")){
      const j = await res.json().catch(()=>null);
      if(j?.error) msg += ` – ${j.error}`;
    } else {
      const t = await res.text().catch(()=> "");
      if(t) msg += `\n${t.slice(0,400)}`;
    }
    throw new Error(msg);
  }
  if(!ct.startsWith("audio/")){
    const txt = await res.text().catch(()=> "");
    throw new Error("TTS svarade inte med ljud.\n" + txt.slice(0,400));
  }

  // visa cache-info
  const cacheHdr = res.headers.get("X-Tts-Cache");
  setCacheBadge(cacheHdr);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  ui.player.src = url;
  ui.playerWrap.style.display = "block";
  try{ await ui.player.play(); } catch{} // browser kan kräva klick
}

// ===== Tala in (placeholder — behåller knappen men rör inte backend) =====
ui.btnTalk.addEventListener("click", ()=>{
  alert("Röstinspelning återkommer i nästa steg utan Whisper. Just nu: skriv sagognistan.");
});
