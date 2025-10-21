const $ = id => document.getElementById(id);
const ui = {
  age:$('age'), hero:$('hero'), prompt:$('prompt'), voice:$('voice'),
  btnTalk:$('btnTalk'), btnMake:$('btnMake'),
  spinner:$('spinner'), spintxt:$('spintxt'),
  status:$('status'), story:$('story'), audio:$('audio')
};

function setBusy(on,text='Arbetar…'){ui.spintxt.textContent=text;ui.spinner.style.display=on?'flex':'none';ui.btnMake.disabled=on;}
function setStatus(msg,ok=true){ui.status.innerHTML=ok?`<span class="ok">✔</span> ${msg}`:`<span class="bad">✖</span> ${msg}`;}

// ===== Mic / Whisper =====
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

// ===== Skapa saga + TTS =====
ui.btnMake.addEventListener('click', async()=>{
  const prompt=ui.prompt.value.trim(); if(!prompt)return setStatus('Skriv eller tala in något först',false);
  setBusy(true,'Skapar saga och ljud…');
  ui.story.textContent=''; ui.audio.removeAttribute('src');
  try{
    const storyRes=await fetch('/api/generate_story',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({prompt,age:ui.age.value,hero:ui.hero.value})
    });
    const storyData=await storyRes.json();
    if(!storyData.ok)throw new Error('Kunde inte skapa saga');
    const story=storyData.story||''; ui.story.textContent=story;
    setStatus('Sagan klar, skapar uppläsning…');

    const ttsRes=await fetch('/tts',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({text:story,voice_id:ui.voice.value||undefined})
    });
    const ttsJson=await ttsRes.json();
    if(!ttsJson.ok)throw new Error(ttsJson.error||'TTS misslyckades');
    ui.audio.src=ttsJson.url; setStatus('Allt klart!',true);
  }catch(e){console.error(e);setStatus(e.message||'Fel',false);}
  finally{setBusy(false);}
});
