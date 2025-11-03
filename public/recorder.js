// public/recorder.js
// Robust recorder som binder en "Starta inspelning"-knapp automatiskt.
// Om knapp inte hittas kan du anropa startAutoRecord() manuellt.
// Den här versionen försöker hitta knappen via selectors OCH via knapptext (svenska/engelska).
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
  ];

  // UI‑selectors (primära)
  const recordBtnSel = '[data-id="btn-record"], #btn-record, .btn-record, button.record';
  const transcriptSel = '[data-id="transcript"], #transcript, textarea[name="transcript"]';

  // State
  let mediaStream = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let audioContext = null;
  let analyser = null;
  let rafId = null;
  let silenceTimerStart = null;
  let startedAt = 0;
  let isRecording = false;

  // ---------------- Helpers ----------------
  function qs(sel){ try { return document.querySelector(sel); } catch(e){ return null; } }
  function qsa(sel){ try { return Array.from(document.querySelectorAll(sel)); } catch(e){ return []; } }

  function findButtonByText(terms){
    // terms: array of lower-case strings to search for
    const btns = Array.from(document.querySelectorAll('button, a[role="button"], input[type="button"], input[type="submit"]'));
    for (const b of btns){
      const text = ((b.innerText || b.value || '') + '').trim().toLowerCase();
      for (const t of terms){
        if (!t) continue;
        if (text.includes(t.toLowerCase())) return b;
      }
    }
    return null;
  }

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
    try { if (window.showSpinner) window.showSpinner(true, msg); else console.log('[recorder] ', msg); } catch(e){ console.log('[recorder] ', msg); }
  }
  function clearNotify(){
    try { if (window.showSpinner) window.showSpinner(false); } catch(e){}
  }

  // ---------------- Transcribe endpoint discovery ----------------
  async function pickTranscribeEndpoint(){
    for (const ep of TRANSCRIBE_ENDPOINTS){
      try {
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

  // ---------------- Audio helpers ----------------
  function calcRMS(floatArray){
    if (!floatArray || floatArray.length === 0) return 0;
    let sum = 0;
    for (let i=0;i<floatArray.length;i++){ const v = floatArray[i]; sum += v*v; }
    return Math.sqrt(sum/floatArray.length);
  }

  function startMonitoringAndStopOnSilence() {
    silenceTimerStart = null;
    const buffer = new Float32Array(analyser.fftSize);
    function loop(){
      analyser.getFloatTimeDomainData(buffer);
      const rms = calcRMS(buffer);
      if (rms > SILENCE_THRESHOLD) {
        silenceTimerStart = null;
      } else {
        if (!silenceTimerStart) silenceTimerStart = Date.now();
        else {
          if (Date.now() - silenceTimerStart >= SILENCE_MS) {
            stopRecording('silence');
            return;
          }
        }
      }
      if (Date.now() - startedAt > MAX_RECORD_MS){
        stopRecording('max_time');
        return;
      }
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
  }

  // ---------------- Recording ----------------
  async function startRecording(){
    if (isRecording) return;
    const recordBtn = resolveRecordButton();
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

    audioChunks = [];
    try {
      mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm' });
    } catch(e) {
      mediaRecorder = new MediaRecorder(mediaStream);
    }

    mediaRecorder.ondataavailable = e => { if (e.data && e.data.size) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      await handleRecordingComplete(blob);
    };

    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(mediaStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
    } catch(e){
      console.warn('AudioContext/analyser error', e);
    }

    startedAt = Date.now();
    isRecording = true;
    try { mediaRecorder.start(1000); } catch(e){ mediaRecorder.start(); }
    notify('Spelar in… vänta på paus i talet för automatisk stopp.');
    if (analyser) startMonitoringAndStopOnSilence();
  }

  function stopRecording(reason='manual'){
    if (!isRecording) return;
    isRecording = false;
    if (rafId) cancelAnimationFrame(rafId);
    try { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); } catch(e){}
    try { if (audioContext) audioContext.close(); } catch(e){}
    try { if (mediaStream) mediaStream.getTracks().forEach(t=>t.stop()); } catch(e){}
    clearNotify();
    const recordBtn = resolveRecordButton();
    setButtonState(recordBtn, 'Starta inspelning', false);
    console.log('Recording stopped:', reason);
  }

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

      setTranscript(transcript);
      if (window.__BN_autoFillPromptFromTranscript && typeof window.applyTranscriptToPrompt === 'function'){
        window.applyTranscriptToPrompt(transcript);
      }

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

  // ---------------- Button resolution and binding ----------------
  function resolveRecordButton(){
    let btn = qs(recordBtnSel);
    if (btn) {
      // console.info('[recorder] Found record button via primary selector.');
      return btn;
    }
    // fallback: find by common Swedish/English texts
    const fallbacks = ['starta inspelning','start recording','spela in','inspelning','starta','start','record'];
    btn = findButtonByText(fallbacks);
    if (btn) {
      console.info('[recorder] Found record button by text:', (btn.innerText || btn.value || '').trim());
      return btn;
    }
    // fallback: try to find the large green button used in UI (common class patterns)
    const heuristics = qsa('.btn, .button, .btn-primary, .primary, .green, .btn-lg');
    if (heuristics.length === 1) {
      console.info('[recorder] Using single .btn-like element as record button.');
      return heuristics[0];
    }
    // nothing found
    console.warn('Record button not found with selectors. Use startAutoRecord() from console or add data-id="btn-record" to the button.');
    return null;
  }

  function bindRecordButton(){
    const btn = resolveRecordButton();
    if (!btn){
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

  // Expose functions
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
