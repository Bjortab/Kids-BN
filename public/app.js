(() => {
  // ===== Helpers =====
  const $ = s => document.querySelector(s);

  // DOM refs
  const childName = $('#childName');
  const ageRange  = $('#ageRange');
  const promptEl  = $('#prompt');
  const heroName  = $('#heroName');
  const useWhisper= $('#useWhisper');

  const btnSpeak  = $('#btnSpeak');
  const btnGen    = $('#btnGenerate');
  const btnSave   = $('#btnSaveHero');
  const btnReset  = $('#btnResetHeroes');

  const statusEl  = $('#status');
  const textOut   = $('#resultText');
  const audioOut  = $('#resultAudio');

  const spinner   = $('#spinner');
  const spinnerMsg= $('#spinnerMsg');

  const setStatus = (msg, type='') => {
    statusEl.textContent = msg || '';
    statusEl.classList.remove('status--ok','status--error');
    if (type) statusEl.classList.add(`status--${type}`);
  };
  const showSpin = (msg='Arbetar…') => { spinnerMsg.textContent = msg; spinner.hidden = false; };
  const hideSpin = () => { spinner.hidden = true; };

  // Large, fixed buttons must always be clickable unless busy
  let busy = false;
  const setBusy = (v, msg='') => {
    busy = v;
    [btnSpeak, btnGen, btnSave, btnReset].forEach(b=> b.disabled = v);
    if (v && msg) showSpin(msg); else hideSpin();
  };

  // ===== Age controls for the backend =====
  const ageToControls = (age) => {
    switch (age) {
      case '1-2':  return { minWords: 30,  maxWords: 70, tone:'bilderbok, djur, bondgård, färger, maskiner', chapters:1 };
      case '3-4':  return { minWords: 120, maxWords: 280, tone:'enkel handling, tydlig början och slut, humor och igenkänning', chapters:1 };
      case '5-6':  return { minWords: 250, maxWords: 450, tone:'lite mer komplex, problem som löses; korta kapitel', chapters:1 };
      case '7-8':  return { minWords: 400, maxWords: 700, tone:'äventyr/mysterier, humor; introducera cliffhangers', chapters:2 };
      case '9-10': return { minWords: 600, maxWords: 1000, tone:'fantasy, vänskap, moral; kapitelkänsla', chapters:2 };
      case '11-12':return { minWords: 900, maxWords: 1400, tone:'djupare teman, karaktärsutveckling', chapters:3 };
      default:     return { minWords: 250, maxWords: 500,  tone:'barnvänlig', chapters:1 };
    }
  };

  // ===== Local heroes store =====
  const heroKey='bn_heroes_v1';
  const loadHeroes = () => { try{ return JSON.parse(localStorage.getItem(heroKey)||'[]'); } catch { return []; } };
  const saveHeroes = (list) => localStorage.setItem(heroKey, JSON.stringify(list.slice(0,50)));

  // ===== Network helpers =====
  async function postJSON(url, body, headers={}) {
    return await fetch(url, {
      method:'POST',
      headers: { 'Content-Type':'application/json', ...headers },
      body: JSON.stringify(body)
    });
  }

  function attachAudioFromBlob(blob) {
    const url = URL.createObjectURL(blob);
    audioOut.hidden = false;
    audioOut.src = url;
    audioOut.play().catch(()=>{ /* autoplay kan blockas */ });
  }

  async function handleTTSResponse(res) {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('audio/')) {
      const blob = await res.blob();
      attachAudioFromBlob(blob);
      return;
    }
    const data = await res.json().catch(()=> ({}));
    if (data && data.audioBase64) {
      const bin = atob(data.audioBase64);
      const buf = new Uint8Array(bin.length);
      for (let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
      attachAudioFromBlob(new Blob([buf], { type:'audio/mpeg' }));
      return;
    }
    throw new Error(data?.error || 'TTS gav inget ljud.');
  }

  // ===== Generate story with read-aloud =====
  btnGen.addEventListener('click', async () => {
    if (busy) return;

    const payload = {
      childName: (childName.value||'').trim(),
      heroName : (heroName.value||'').trim(),
      ageRange : (ageRange.value||'').trim(),
      prompt   : (promptEl.value||'').trim(),
      controls : ageToControls(ageRange.value),
      read_aloud: true
    };
    if (!payload.prompt && !useWhisper.checked) {
      setStatus('Skriv något i sagognistan eller använd Tala in.', 'error');
      return;
    }

    setBusy(true, 'Skapar sagan…');
    textOut.textContent = '';
    audioOut.hidden = true;
    audioOut.removeAttribute('src');

    try {
      const storyRes = await postJSON('/api/generate_story', payload);
      if (storyRes.status === 405) {
        // fallback om funktionen ligger på /generate_story
        const storyRes2 = await postJSON('/generate_story', payload);
        if (!storyRes2.ok) throw new Error('Servern accepterar inte POST på generate_story.');
        const j2 = await storyRes2.json();
        if (!j2?.ok) throw new Error(j2?.error || 'Okänt fel från generate_story.');
        textOut.textContent = j2.story || '';
      } else {
        const j = await storyRes.json().catch(()=> ({}));
        if (!storyRes.ok || !j?.ok) throw new Error(j?.error || `Serverfel: ${storyRes.status}`);
        textOut.textContent = j.story || '';
      }

      setBusy(true, 'Skapar uppläsning…');
      // prova /api/tts först, fallback /tts
      let tts = await fetch('/api/tts', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text: textOut.textContent }) });
      if (tts.status === 404 || tts.status === 405) {
        tts = await fetch('/tts', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text: textOut.textContent }) });
      }
      if (!tts.ok) {
        const t = await tts.text().catch(()=> '');
        throw new Error(`TTS misslyckades: ${tts.status} ${t}`);
      }
      await handleTTSResponse(tts);

      setStatus('Klar!', 'ok');
    } catch (err) {
      setStatus(String(err?.message || err), 'error');
    } finally {
      setBusy(false);
    }
  });

  // ===== Record -> Whisper =====
  let rec, chunks=[];
  function hasRecording() { return typeof MediaRecorder !== 'undefined'; }

  btnSpeak.addEventListener('click', async () => {
    if (busy) return;

    if (!hasRecording()) {
      setStatus('Din webbläsare stödjer inte inspelning. Testa Chrome/Edge/Firefox på mobil eller desktop.', 'error');
      return;
    }

    try {
      if (!rec || rec.state === 'inactive') {
        const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
        chunks = [];
        rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
        rec.onstop = async () => {
          try {
            setBusy(true, 'Skickar ljud till Whisper…');
            const blob = new Blob(chunks, { type:'audio/webm' });
            // multipart
            const fd = new FormData();
            fd.append('file', blob, 'speech.webm');

            let r = await fetch('/api/whisper_transcribe', { method:'POST', body: fd });
            if (r.status === 404 || r.status === 405) {
              r = await fetch('/whisper_transcribe', { method:'POST', body: fd });
            }
            if (!r.ok) {
              const t = await r.text().catch(()=> '');
              throw new Error(`Whisper fel: ${r.status} ${t}`);
            }
            const j = await r.json();
            promptEl.value = (j?.text || '').trim();
            setStatus('Talet transkriberat.', 'ok');
          } catch (e) {
            setStatus(e?.message || String(e), 'error');
          } finally {
            setBusy(false);
          }
        };
        rec.start();
        btnSpeak.classList.add('is-recording');
        setStatus('Spelar in… tryck igen för att stoppa.');
      } else {
        rec.stop();
        btnSpeak.classList.remove('is-recording');
      }
    } catch (e) {
      setStatus('Mikrofonfel: ' + (e?.message || e), 'error');
    }
  });

  // ===== Save/Reset heroes =====
  btnSave.addEventListener('click', () => {
    const h = (heroName.value||'').trim();
    if (!h) { setStatus('Skriv ett hjältenamn först.', 'error'); return; }
    const list = loadHeroes();
    if (!list.includes(h)) list.unshift(h);
    saveHeroes(list);
    setStatus(`Sparade hjälten ${h}.`, 'ok');
  });

  btnReset.addEventListener('click', () => {
    saveHeroes([]); setStatus('Rensade sparade hjältar.', 'ok');
  });

  // init
  setStatus('');
})();
