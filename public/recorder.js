// public/recorder.js
// Robust recorder som binder en "Starta inspelning"-knapp automatiskt.
// Förbättringar i denna version:
// - Ta inte bort eller ändra text på andra knappar (undantag endast om knapp är markerad med data-id/#btn-record/.btn-record).
// - Avstår från OPTIONS-probing som gav 405; skickar POST när blob finns och hanterar 4xx/5xx.
// - Fler kontroller i resolveRecordButton så fel knapp inte väljs.
(function(){
  'use strict';

  // ---------------- Konfig ----------------
  const SILENCE_THRESHOLD = 0.02; // RMS under denna = tyst (sänk vid svaga barnröster)
  const SILENCE_MS = 3500;        // ms tystnad innan inspelning stoppas (3.5s)
  const MAX_RECORD_MS = 60000;    // max inspelningstid i ms (60s)
  // Primär transcribe endpoint (skicka POST direkt). Lägg till fler endpoints här om din backend har andra vägar.
  const TRANSCRIBE_ENDPOINT = '/api/whisper';

  // UI‑selectors (primära)
  const recordBtnSel = '[data-id="btn-record"], #btn-record, .btn-record, button.record';
  const transcriptSel = '[data-id="transcript"], #transcript, textarea[name="transcript"]';
  const promptSel = '#prompt, textarea[name="prompt"], [data-id="prompt"], .prompt';

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

  // Viktigt: vi ändrar inte knappens innerText UNLESS knappen är tydligt avsedd för inspelning.
  // Här gör vi en säker ändring: om knappen har markerande selektor (data-id/#btn-record/.btn-record) så får vi skriva över text.
  // Annars sätter vi endast aria-label, title och css‑klass 'bn-recording' för visuell feedback.
  function setRecordingVisual(btn, isRecording){
    if (!btn) return;
    const safeToReplaceText = (btn.matches && (btn.matches('[data-id="btn-record"], #btn-record, .btn-record')));
    if (isRecording) {
      btn.classList.add('bn-recording');
      btn.setAttribute('aria-pressed', 'true');
      btn.setAttribute('title', 'Inspelning pågår');
      if (safeToReplaceText) {
        // spara originaltext om inte sparat
        if (!btn.dataset.bnOriginal) btn.dataset.bnOriginal = btn.innerText || btn.value || '';
        try { btn.textContent = 'Lyssnar…'; } catch(e){}
      }
    } else {
      btn.classList.remove('bn-recording');
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('title', 'Starta inspelning');
      if (safeToReplaceText && btn.dataset.bnOriginal) {
        try { btn.textContent = btn.dataset.bnOriginal; } catch(e){}
      }
    }
  }

  function setButtonDisabled(btn, disabled){
    try { if (btn) btn.disabled = !!disabled; } catch(e){}
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
    // Visual feedback utan att skriva över andras knapptexter (se setRecordingVisual)
    setRecordingVisual(recordBtn, true);
    setButtonDisabled(recordBtn, true); // disabla knappen för att undvika dubbelklick
    notify('Tillåt mikrofon och prata när du är redo…');
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      clearNotify();
      setRecordingVisual(recordBtn, false);
      setButtonDisabled(recordBtn, false);
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
    setRecordingVisual(recordBtn, false);
    setButtonDisabled(recordBtn, false);
    console.log('Recording stopped:', reason);
  }

  // ---------------- When recording is done ----------------
  async function handleRecordingComplete(blob){
    notify('Transkriberar…');
    const endpoint = TRANSCRIBE_ENDPOINT;
    console.log('[recorder] Using transcribe endpoint:', endpoint);
    try {
      const fd = new FormData();
      fd.append('file', blob, 'recording.webm');
      // Skicka POST direkt — server kan svara 4xx/5xx, vi hanterar det.
      const res = await fetch(endpoint, { method: 'POST', body: fd });
      if (!res.ok) {
        const t = await res.text().catch(()=>'<no-body>');
        console.warn('[recorder] Transcribe failed', res.status, t);
        alert('Transkribering misslyckades: ' + res.status + (t?(' — ' + t):''));
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
        console.warn('[recorder] Empty transcript from server');
        alert('Transkribering gav ingen text. Försök igen.');
        return;
      }

      // Sätt transkript i UI och autofyll prompt direkt
      setTranscript(transcript);
      try {
        const apply = window.applyTranscriptToPrompt;
        if (window.__BN_autoFillPromptFromTranscript && typeof apply === 'function') {
          apply(transcript);
        }
      } catch(e){ console.warn(e); }

      // Skapa saga och spela upp automatiskt om funktioner finns
      try {
        notify('Skapar berättelse…');
        if (typeof window.createStory === 'function'){
          await window.createStory();
        } else {
          console.warn('[recorder] window.createStory missing');
        }
      } catch (e) {
        console.error('[recorder] createStory failed', e);
      }

      try {
        notify('Spelar upp berättelsen…');
        await new Promise(r => setTimeout(r, 600));
        if (typeof window.playTTS === 'function'){
          await window.playTTS();
        } else {
          console.warn('[recorder] window.playTTS missing');
        }
      } catch (e) {
        console.error('[recorder] playTTS failed', e);
      } finally {
        clearNotify();
      }

    } catch (err) {
      console.error('[recorder] Transcribe error', err);
      alert('Ett fel uppstod vid transkribering: ' + (err.message || String(err)));
    }
  }

  // ---------------- Button resolution and binding ----------------
  function resolveRecordButton(){
    // 1) försöka primära selectors
    let btn = qs(recordBtnSel);
    if (btn) {
      console.info('[recorder] Found record button via primary selector.');
      return btn;
    }

    // 2) försök matcha specifika texts som indikerar record
    const fallbacks = ['starta inspelning','start recording','spela in','inspelning','lyssna','lyssnar','start','record'];
    btn = findButtonByText(fallbacks);
    if (btn) {
      console.info('[recorder] Found record button by text:', (btn.innerText || btn.value || '').trim());
      return btn;
    }

    // 3) Heuristics: endast om det finns exakt EN tydlig .btn-like element OCH dess text matchar ett inspelningsord.
    const heuristics = qsa('.btn, .button, .btn-primary, .primary, .green, .btn-lg');
    if (heuristics.length === 1) {
      const candidate = heuristics[0];
      const t = ((candidate.innerText || '') + '').toLowerCase();
      const allowed = ['start','spela in','starta inspelning','inspelning','lyssna','lyssnar','record'];
      if (allowed.some(a => t.includes(a))) {
        console.info('[recorder] Using single .btn-like element as record button (heuristic).');
        return candidate;
      }
    }

    // Nothing found
    console.warn('[recorder] Record button not found with selectors. Use startAutoRecord() from console or add data-id="btn-record" to the button.');
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

  // ---------------- Expose functions ----------------
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
