const $ = id => document.getElementById(id);
const ui = {
  age:$('age'), hero:$('hero'), prompt:$('prompt'), voice:$('voice'),
  btnTalk:$('btnTalk'), btnMake:$('btnMake'),
  spinner:$('spinner'), spintxt:$('spintxt'),
  status:$('status'), story:$('story'), audio:$('audio')
};

function setBusy(on,text='Arbetar…'){ui.spintxt.textContent=text;ui.spinner.style.display=on?'flex':'none';ui.btnMake.disabled=on;}
function setStatus(msg,ok=true){ui.status.innerHTML=ok?`<span class="ok">✔</span> ${msg}`:`<span class="bad">✖</span> ${msg}`;}

// ---------- Åldersprofiler (låst) ----------
function ageToControls(age){
  switch(age){
    case '1–2 år':
      return {            // ultrakort, pekbokskänsla
        minChars: 60, maxChars: 90,
        minWords: 8, maxWords: 20,
        chapters: 1,
        pageBreakTag: '[BYT SIDA]',
        styleHint: 'pekbok; ljudord; enkla tvåordsmeningar; varje mening kan stå på egen sida; inga långa satser'
      };
    case '3–4 år':
      return {
        minWords: 80, maxWords: 160,
        chapters: 1,
        styleHint: 'korta meningar; igenkänning; humor; tydlig början-slut; gärna 3–5 scener'
      };
    case '5–6 år':
      return {
        minWords: 180, maxWords: 320,
        chapters: 1,
        styleHint: 'problem–lösning; varm ton; enkla cliffhangers men naturligt slut'
      };
    case '7–8 år':
      return {
        minWords: 350, maxWords: 600,
        chapters: 1,
        styleHint: 'äventyr/mysterium; tydliga val; varierade scener; naturligt slut (ingen mallfras)'
      };
    case '9–10 år':
      return {
        minWords: 500, maxWords: 900,
        chapters: 2,
        styleHint: 'tempo + känsla; miljöbeskrivningar men lättläst; inga klyschiga avslut'
      };
    case '11–12 år':
      return {
        minWords: 700, maxWords: 1200,
        chapters: 2,
        styleHint: 'spänning; smart problemlösning; respektfull ton; inga predikande slut'
      };
    default:
      return {minWords:200,maxWords:400,chapters:1,styleHint:'naturligt slut'};
  }
}

// ---------- Mic / Whisper ----------
let recorder, chunks=[];
ui.btnTalk.addEventListener('click', async ()=>{
  if(recorder && recorder.state==='recording'){recorder.stop();return;}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    recorder=new MediaRecorder(stream); chunks=[];
    recorder.ondataavailable=e=>{if(e.data.size>0)chunks.push(e.data)};
    recorder.onstop=async ()=>{
      const blob=new Blob(chunks,{type:'audio/webm'});
      await transcribe(blob);
      stream.getTracks().forEach(t=>t.stop());
      ui.btnTalk.textContent='🎙️ Tala in';
    };
    recorder.start();
    ui.btnTalk.textContent='⏹️ Stoppa';
    setStatus('Spelar in… tala tydligt',true);
    // auto-stop vid tystnad? enkel timeout (8 s) – fungerar stabilt på webben
    setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},8000);
  }catch(e){console.error(e);setStatus('Kunde inte starta mikrofonen',false);}
});

async function transcribe(blob){
  setBusy(true,'Tolkar tal…');
  const fd=new FormData(); fd.append('audio',blob,'speech.webm');
  try{
    const r=await fetch('/whisper_transcribe',{method:'POST',body:fd});
    const j=await r.json(); if(j.text){ui.prompt.value=j.text;}
    setStatus('Talet konverterat till text',true);
  }catch(e){setStatus('Misslyckades med transkribering',false);}
  finally{setBusy(false);}
}

// ---------- Skapa saga + TTS ----------
ui.btnMake.addEventListener('click', async()=>{
  const prompt=ui.prompt.value.trim(); if(!prompt)return setStatus('Skriv eller tala in något först',false);
  const controls=ageToControls(ui.age.value);
  setBusy(true,'Skapar saga och ljud…');
  ui.story.textContent=''; ui.audio.removeAttribute('src');

  try{
    // 1) Generera sagan
    const storyRes=await fetch('/api/generate_story',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({prompt,age:ui.age.value,hero:ui.hero.value,controls})
    });
    const storyData=await storyRes.json();
    if(!storyData.ok) throw new Error(storyData.error||'Kunde inte skapa saga');
    const story=storyData.story||'';
    ui.story.textContent=story;
    setStatus('Sagan klar, skapar uppläsning…');

    // 2) Skapa TTS – acceptera både JSON & audio
    const ttsRes=await fetch('/tts',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({text:story,voice_id:ui.voice.value||undefined})
    });

    const ct = (ttsRes.headers.get('content-type')||'').toLowerCase();

    if (ct.startsWith('audio/')) {
      // Rå MP3 från servern
      const blob = await ttsRes.blob();
      const url = URL.createObjectURL(blob);
      ui.audio.src = url;
      setStatus('Allt klart!',true);
    } else if (ct.includes('application/json')) {
      const j = await ttsRes.json();
      if(!j.ok) throw new Error(j.error||'TTS misslyckades');
      ui.audio.src = j.url;
      setStatus('Allt klart!',true);
    } else {
      // Oförväntad payload (t.ex. HTML fel-sida)
      const txt = await ttsRes.text();
      console.error('TTS oväntat svar:', txt);
      throw new Error('TTS misslyckades (oväntat svar från servern)');
    }
  }catch(e){
    console.error(e);
    setStatus(e.message||'Fel',false);
  }finally{
    setBusy(false);
  }
});
