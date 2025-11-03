// public/recorder.js
// Automatisk inspelning med tystnadsdetektion -> transkribera -> autofyll prompt -> skapa saga -> spela upp.
// Fullständig fil — klistra in som public/recorder.js
//
// Beroenden (ska finnas i din klientkod):
// - window.applyTranscriptToPrompt(transcript)   // kopierar transcript till promptfältet
// - window.createStory()                         // skapar saga (kan vara async)
// - window.playTTS()                             // spelar upp sagan (kan vara async)
//
// Konfigurera vid behov: SILENCE_THRESHOLD, SILENCE_MS, MAX_RECORD_MS, TRANSCRIBE_ENDPOINTS.

(function(){
  'use strict';

  // ---------------- Konfig ----------------
  const SILENCE_THRESHOLD = 0.02; // RMS under denna = tyst (sänk vid svaga barnröster)
  const SILENCE_MS = 3500;        // ms tystnad innan inspelning stoppas (3.5s)
  const MAX_RECORD_MS = 60000;    // max inspelningstid i ms (60s)
  const TRANSCRIBE_ENDPOINTS = [
    '/api/whisper',
    '/whisper_transcribe',
    '/api/stt',
    '/api/whisper_transcribe',
    '/api/recognize'
  ]; // Försöker dessa i ordning för att hitta transcribe endpoint.

  // UI‑selectors (anpassa om ditt HTML har andra attribut)
  const recordBtnSel = '[data-id="btn-record"], #btn-record, .btn-record, button.record';
  const transcriptSel = '[data-id="transcript"], #transcript, textarea[name="transcript"]';

  // ---------------- State ----------------
  let mediaStream = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let audioContext = null;
  let analyser = null;
  let rafId = null;
  let silenceTimerStart = null;
  let startedAt = 0;
  let isRecording = false;

  // ---------------- Helpers: UI ----------------
  function qs(sel){ try { return document.querySelector(sel); } catch(e){ return null; } }
  function setButtonState(btn, text, disabled){
    try { if(btn){ btn.textContent = text; btn.disabled = !!disabled; } } catch(e){}
  }
  function setTranscript(text){
    const el = qs(transcriptSel);
    if (!el) return;
    if ('value' in el) el.value = text;
    else el.textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function notify(msg){
    // Försök använda global showSpinner om definierad, annars console.log
    try { if (window.showSpinner) window.showSpinner(true, msg); else console.log('[recorder] ', msg); } catch(e){ console.log('[recorder] ', msg); }
  }
  function clearNotify(){
    try { if (window.showSpinner) window.showSpinner(false); } catch(e){}
  }

  // ---------------- Transcribe endpoint discovery ----------------
  async function pickTranscribeEndpoint(){
    for (const ep of TRANSCRIBE_ENDPOINTS){
      try {
        // OPTIONS används för att snabbt kontrollera CORS/tilgänglighet
        const res = await fetch(ep, { method: 'OPTIONS' });
        if (res && (res.ok || res.status === 204 || res.status === 200)) return ep;
      } catch(e){}
      try {
        const res2 = await fetch(ep, { method: 'GET' });
        if (res2 && (res2.ok || res2.status === 200)) return ep;
      } catch(e){}
    }
    return TRANSCRIBE_ENDPOINTS[0];
  }

  // ---------------- Audio analyser helpers ----------------
  function calcRMS(floatArray, useFloat=true){
    if (!floatArray || floatArray.length === 0) return 0;
    let sum = 0;
    if (useFloat) {
      for (let i=0;i<floatArray.length;i++){ const v = floatArray[i]; sum += v*v; }
    } else {
      for (let i=0;i<floatArray.length;i++){ const v = (floatArray[i]-128)/128; sum += v*v; }
    }
    return Math.sqrt(sum/floatArray.length);
  }

  // Monitoring loop för tystnadsdetektion
  function startMonitoringAndStopOnSilence() {
    silenceTimerStart = null;
    const buffer = new Float32Array(analyser.fftSize);
    function loop(){
      analyser.getFloatTimeDomainData(buffer);
      const rms = calcRMS(buffer, true);
      if (rms > SILENCE_THRESHOLD) {
        // tal upptäckt => nollställ tystnadstimern
        silenceTimerStart = null;
      } else {
        // tyst
        if (!silenceTimerStart) silenceTimerStart = Date.now();
        else {
          if (Date.now() - silenceTimerStart >= SILENCE_MS) {
            stopRecording('silence');
            return;
          }
        }
      }
      // max tid check
      if (Date.now() - startedAt > MAX_RECORD_MS){
        stopRecording('max_time');
        return;
      }
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
  }

  // ---------------- Start inspelning ----------------
  async function startRecording(){
    if (isRecording) return;
    const recordBtn = qs(recordBtnSel);
    setButtonState(recordBtn, 'Lyssnar…', true);
    notify('Tillåt mikrofon och prata när du är redo…');
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      clearNotify();
      setButtonState(recordBtn, 'Starta inspelning', false);
      console.error('Mic permission denied or error', err);
      alert('Mikrofontillgång nekad eller inte tillgänglig. Kontrollera att du tillåter mikrofonen.');
      return;
    }

    // Setup MediaRecorder
    audioChunks = [];
    try {
      mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm' });
    } catch(e) {
      // Fallback utan mimeType om det ger fel i vissa browsers
      mediaRecorder = new MediaRecorder(mediaStream);
    }

    mediaRecorder.ondataavailable = e => { if (e.data && e.data.size) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      await handleRecordingComplete(blob);
    };

    // Setup analyser för VAD
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(mediaStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
    } catch(e){
      console.warn('AudioContext/analyser error', e);
      // Fortsätt ändå utan VAD (då måste användaren manuellt stoppa)
    }

    // Starta inspelning
    startedAt = Date.now();
    isRecording = true;
    try { mediaRecorder.start(1000); } catch(e){ mediaRecorder.start(); }
    notify('Spelar in… vänta på paus i talet för automatisk stopp.');
    if (analyser) startMonitoringAndStopOnSilence();
  }

  // ---------------- Stop inspelning ----------------
  function stopRecording(reason='manual'){
    if (!isRecording) return;
    isRecording = false;
    if (rafId) cancelAnimationFrame(rafId);
    try { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); } catch(e){}
    try { if (audioContext) audioContext.close(); } catch(e){}
    try { if (mediaStream) mediaStream.getTracks().forEach(t=>t.stop()); } catch(e){}
    clearNotify();
    const recordBtn = qs(recordBtnSel);
    setButtonState(recordBtn, 'Starta inspelning', false);
    console.log('Recording stopped:', reason);
  }

  // ---------------- När inspelning klar ----------------
  async function handleRecordingComplete(blob){
    notify('Transkriberar…');
    const endpoint = await pickTranscribeEndpoint();
    console.log('Using transcribe endpoint:', endpoint);
    try {
      const fd = new FormData();
      fd.append('file', blob, 'recording.webm');
      const res = await fetch(endpoint, { method: 'POST', body: fd });
      if (!res.ok) {
        const t = await res.text().catch(()=>'<no-body>');
        console.warn('Transcribe failed', res.status, t);
        alert('Transkribering misslyckades: ' + res.status);
        return;
      }

      // Försök tolka JSON eller text
      let transcript = '';
      try {
        const json = await res.json();
        transcript = json.transcript || json.text || json.result || (typeof json === 'string' ? json : '');
        if (!transcript && json?.data) transcript = JSON.stringify(json.data).slice(0,200);
      } catch (e) {
        const txt = await res.text().catch(()=>'');
        transcript = txt || '';
      }

      transcript = (transcript || '').trim();
      if (!transcript) {
        console.warn('Empty transcript from server');
        alert('Transkribering gav ingen text. Försök igen.');
        return;
      }

      // Placera i transkriptfält (om finns) och i prompt direkt (autofyll)
      setTranscript(transcript);
      if (window.__BN_autoFillPromptFromTranscript && typeof window.applyTranscriptToPrompt === 'function'){
        window.applyTranscriptToPrompt(transcript);
      }

      // Direkt: skapa saga och spela upp (minimera knapptryck)
      try {
        notify('Skapar berättelse…');
        if (typeof window.createStory === 'function'){
          await window.createStory();
        } else {
          console.warn('window.createStory missing');
        }
      } catch (e) {
        console.error('createStory failed', e);
      }

      // Vänta kort och spela upp om playTTS finns
      try {
        notify('Spelar upp berättelsen…');
        await new Promise(r => setTimeout(r, 600));
        if (typeof window.playTTS === 'function'){
          await window.playTTS();
        } else {
          console.warn('window.playTTS missing');
        }
      } catch (e) {
        console.error('playTTS failed', e);
      } finally {
        clearNotify();
      }

    } catch (err) {
      console.error('Transcribe error', err);
      alert('Ett fel uppstod vid transkribering: ' + (err.message || String(err)));
    }
  }

  // ---------------- Bindning ----------------
  function bindRecordButton(){
    const btn = qs(recordBtnSel);
    if (!btn){
      console.warn('Record button not found with selectors. Use startAutoRecord() from console or add data-id="btn-record" to your button.');
      return;
    }
    btn.addEventListener('click', (e) => {
      e.preventDefault?.();
      if (isRecording) {
        stopRecording('user');
      } else {
        startRecording();
      }
    });
  }

  // ---------------- Expose global functions ----------------
  window.startAutoRecord = startRecording;
  window.stopAutoRecord = stopRecording;
  window.isAutoRecording = () => isRecording;

  // Auto bind on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindRecordButton);
  } else {
    bindRecordButton();
  }

})();
