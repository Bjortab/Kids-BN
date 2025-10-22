// public/app.js — Google TTS front med reglage
// - Rör inte dina andra API:er (generate_story osv.)
// - reuse:false vid “Skapa…” (nytt ljud), reuse:true vid “Spela igen” (cache-HIT om samma text)
// - Reglage: röst, hastighet (diskreta små steg), pitch, volym, ljudprofil
// - “Testa röst” spelar upp en kort provreplik via /tts

const $ = id => document.getElementById(id);
const ui = {
  age: $("age"),
  hero: $("hero"),
  prompt: $("prompt"),

  voice: $("voice"),
  rate: $("rate"),
  pitch: $("pitch"),
  pitchVal: $("pitchVal"),
  volume: $("volume"),
  volumeVal: $("volumeVal"),
  profile: $("profile"),

  btnTalk: $("btnTalk"),
  btnMake: $("btnMake"),
  btnReplay: $("btnReplay"),
  btnTest: $("btnTest"),

  spinner: $("spinner"),
  err: $("err"),

  story: $("story"),
  player: $("player"),
  playerWrap: $("playerWrap"),
  cacheBadge: $("cacheBadge")
};

// ===== UI helpers =====
function setBusy(b){ ui.spinner.style.display = b ? "inline-flex" : "none"; }
function showErr(msg){ ui.err.style.display="block"; ui.err.textContent = msg; }
function clearErr(){ ui.err.style.display="none"; ui.err.textContent = ""; }
function setCacheBadge(v){ if(!v){ ui.cacheBadge.style.display="none"; return; } ui.cacheBadge.textContent=`Cache: ${v}`; ui.cacheBadge.style.display="inline-block"; }

// Show live values for sliders
function syncSliderLabels(){
  ui.pitchVal.textContent = (parseFloat(ui.pitch.value)||0).toFixed(1);
  const vdb = parseInt(ui.volume.value,10)||0;
  ui.volumeVal.textContent = `${vdb} dB`;
}
ui.pitch.addEventListener("input", syncSliderLabels);
ui.volume.addEventListener("input", syncSliderLabels);
syncSliderLabels();

// ===== Ålderskontroller (tips till backend — backendkoden ändras inte här) =====
function ageToControls(age){
  switch(age){
    case '1–2 år':  return { minChars:60, maxChars:90,  minWords:8,  maxWords:20,  chapters:1, styleHint:'pekbok; mycket korta meningar; ljudord; [BYT SIDA] vid behov' };
    case '3–4 år':  return { minWords:80,  maxWords:160, chapters:1, styleHint:'korta meningar; 3–5 scener; humor; naturligt slut' };
    case '5–6 år':  return { minWords:180, maxWords:320, chapters:1, styleHint:'problem–lösning; varm ton; naturligt slut (inga mallfraser)' };
    case '7–8 år':  return { minWords:350, maxWords:600, chapters:1, styleHint:'äventyr; tydliga val; varierade scener; naturligt slut' };
    case '9–10 år': return { minWords:500, maxWords:900, chapters:2, styleHint:'tempo + känsla; miljö utan svåra ord' };
    case '11–12 år':return { minWords:700, maxWords:1200,chapters:2, styleHint:'spänning; smart problemlösning; respektfull ton' };
    default:        return { minWords:200, maxWords:400, chapters:1, styleHint:'barnvänlig' };
  }
}

// ===== Skapa saga + uppläsning =====
ui.btnMake.addEventListener("click", async ()=>{
  clearErr(); setBusy(true); setCacheBadge(null);
  try{
    const prompt = ui.prompt.value.trim();
    if(!prompt) throw new Error("Skriv eller tala in något först.");

    const controls = ageToControls(ui.age.value);

    // 1) Skapa story (din befintliga endpoint)
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

    // 2) TTS direkt (reuse:false => nytt ljud)
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

// ===== Testa röst (snabb provreplik, stör inte storyn) =====
ui.btnTest.addEventListener("click", async ()=>{
  clearErr(); setBusy(true); setCacheBadge(null);
  try{
    const sample = "Hej! Jag är BN:s sagoröst. Nu provar vi hur rösten låter.";
    await speak(sample, { reuse:false });
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
    languageCode: "sv-SE"
  };

  // röst
  const v = (ui.voice.value || "").trim();
  if (v) body.voice = v;

  // hastighet (diskreta små steg)
  const rateStr = (ui.rate.value || "").trim();
  if (rateStr) {
    const sr = parseFloat(rateStr);
    if (!Number.isNaN(sr)) body.speakingRate = sr;
  }

  // pitch
  const pt = parseFloat(ui.pitch.value || "0");
  if (!Number.isNaN(pt)) body.pitch = pt;

  // volym
  const vol = parseInt(ui.volume.value || "0", 10);
  if (!Number.isNaN(vol)) body.volumeGainDb = vol;

  // ljudprofil
  const profile = (ui.profile.value || "").trim();
  if (profile) body.effectsProfileId = [profile]; // Google förväntar sig array

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

  const cacheHdr = res.headers.get("X-Tts-Cache");
  setCacheBadge(cacheHdr);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  ui.player.src = url;
  ui.playerWrap.style.display = "block";
  try{ await ui.player.play(); } catch{}
}

// ===== Tala in (placeholder — rör inte backend) =====
ui.btnTalk.addEventListener("click", ()=>{
  alert("Röstinspelning återkommer i nästa steg utan Whisper. Just nu: skriv sagognistan.");
});
