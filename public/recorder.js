// public/recorder.js — defensiv MediaRecorder klient
// Spelar in upp till 60s, POST -> /api/whisper_transcribe (fältnamn 'file')
// Klarar av att inte finnas i alla layouts utan att kasta fel.

(() => {
  try {
    const micBtn = document.getElementById('mic');
    const cancelBtn = document.getElementById('cancel');
    const statusEl = document.getElementById('rec-status');
    const transcriptEl = document.getElementById('transcript');
    const useBtn = document.getElementById('use-transcript');
    const clearBtn = document.getElementById('clear-transcript');
    const promptEl = document.getElementById('prompt');

    if (!micBtn) {
      console.warn('[recorder] ingen mic-knapp i DOM — avbryter recorder init.');
      return;
    }

    let mediaRecorder = null;
    let chunks = [];
    let streamRef = null;
    let stopTimeout = null;
    const MAX_SECONDS = 60;
    const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

    function setStatus(s){ if (statusEl) statusEl.textContent = s; else console.log('[recorder]', s); }

    async function startRecording() {
      try {
        setStatus('Får åtkomst till mikrofon…');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef = stream;
        mediaRecorder = new MediaRecorder(stream);
        chunks = [];
        mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        mediaRecorder.onstop = onStopRecording;
        mediaRecorder.onerror = (e) => {
          console.error('MediaRecorder error', e);
          setStatus('Fel vid inspelning');
          cleanupStream();
        };
        mediaRecorder.start();
        stopTimeout = setTimeout(() => {
          if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
        }, MAX_SECONDS * 1000);
        micBtn.textContent = 'Stoppa inspelning';
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
        setStatus('Spelar in… (max ' + MAX_SECONDS + 's)');
      } catch (err) {
        console.error('getUserMedia error', err);
        alert('Kunde inte få åtkomst till mikrofonen: ' + (err.message || err));
        setStatus('Fel: ingen åtkomst');
      }
    }

    function stopRecording() {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        setStatus('Stoppar inspelning…');
        micBtn.disabled = true;
      }
    }

    function cancelRecording() {
      if (stopTimeout) { clearTimeout(stopTimeout); stopTimeout = null; }
      try { if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop(); } catch(e){}
      chunks = [];
      cleanupStream();
      setStatus('Avbröts');
      micBtn.textContent = 'Starta inspelning';
      micBtn.disabled = false;
      if (cancelBtn) cancelBtn.style.display = 'none';
    }

    function cleanupStream() {
      if (streamRef) {
        streamRef.getTracks().forEach(t => t.stop());
        streamRef = null;
      }
      mediaRecorder = null;
    }

    async function onStopRecording() {
      if (stopTimeout) { clearTimeout(stopTimeout); stopTimeout = null; }
      setStatus('Skapar ljudfil…');
      const blob = new Blob(chunks, { type: 'audio/webm' });
      chunks = [];
      cleanupStream();

      if (blob.size > MAX_BYTES) {
        alert('Inspelningen är för stor (' + Math.round(blob.size/1024/1024) + ' MB). Försök kortare inspelning.');
        setStatus('Fel: fil för stor');
        micBtn.disabled = false;
        micBtn.textContent = 'Starta inspelning';
        if (cancelBtn) cancelBtn.style.display = 'none';
        return;
      }

      try {
        setStatus('Skickar ljud för transkribering…');
        const fd = new FormData();
        fd.append('file', blob, 'recording.webm');
        fd.append('language', 'sv');

        const resp = await fetch('/api/whisper_transcribe', { method: 'POST', body: fd });
        if (!resp.ok) {
          const txt = await resp.text().catch(()=>'');
          console.error('Transcribe svar: ', resp.status, txt);
          alert('Transkribering misslyckades: ' + resp.status);
          setStatus('Fel vid transkribering');
          micBtn.disabled = false;
          micBtn.textContent = 'Starta inspelning';
          if (cancelBtn) cancelBtn.style.display = 'none';
          return;
        }

        const data = await resp.json().catch(async ()=> {
          const text = await resp.text().catch(()=> '');
          return { text };
        });

        const text = data.text || data?.result || '';
        if (text) {
          transcriptEl.value = (transcriptEl.value ? transcriptEl.value + '\n' : '') + text.trim();
          setStatus('Klar');
        } else {
          setStatus('Klar (inget transkript)');
        }
      } catch (err) {
        console.error('Upload/transcribe failed', err);
        alert('Fel vid uppladdning eller transkribering: ' + err.message);
        setStatus('Fel');
      } finally {
        micBtn.disabled = false;
        micBtn.textContent = 'Starta inspelning';
        if (cancelBtn) cancelBtn.style.display = 'none';
      }
    }

    // Event listeners
    micBtn.addEventListener('click', () => {
      if (!mediaRecorder || (mediaRecorder && mediaRecorder.state === 'inactive')) {
        startRecording();
      } else if (mediaRecorder.state === 'recording') {
        stopRecording();
      }
    });

    if (cancelBtn) cancelBtn.addEventListener('click', cancelRecording);
    if (useBtn) useBtn.addEventListener('click', () => {
      const txt = (transcriptEl.value || '').trim();
      if (!txt) return alert('Inget transkript att använda.');
      if (promptEl) promptEl.value = txt;
      alert('Transkript använt som prompt.');
    });
    if (clearBtn) clearBtn.addEventListener('click', () => transcriptEl.value = '');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('Mikrofon ej tillgänglig i denna webbläsare.');
      micBtn.disabled = true;
    }
  } catch (e) {
    console.error('[recorder] init failed', e);
  }
})();
