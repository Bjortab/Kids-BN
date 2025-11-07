// public/app.js — komplett fil: createStory + playTTS + binders
// Byt ut befintlig public/app.js mot den här och deploya Pages/Functions.

(function(){
  'use strict';
  const log = (...a) => console.log('[BN]', ...a);
  const warn = (...a) => console.warn('[BN]', ...a);

  function qs(sel){ try { return document.querySelector(sel); } catch(e){ return null; } }

  // Parse age value "1" or "3-4" -> {min,max}
  function parseAgeValue(ageVal) {
    if (ageVal === null || typeof ageVal === 'undefined') return null;
    const s = String(ageVal).trim();
    const range = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range) return { min: parseInt(range[1],10), max: parseInt(range[2],10) };
    const single = s.match(/^(\d+)$/);
    if (single) { const n = parseInt(single[1],10); return { min:n, max:n }; }
    return null;
  }

  function setError(text){
    const errorEl = qs('[data-id="error"]') || qs('.error');
    if (!errorEl) return console.error('[BN] error:', text);
    errorEl.style.display = text ? 'block' : 'none';
    errorEl.textContent = text || '';
  }

  function showSpinner(on, statusText){
    const s = qs('[data-id="spinner"]');
    if (!s) return;
    s.style.display = on ? 'flex' : 'none';
    if (typeof statusText !== 'undefined') {
      const st = s.querySelector('[data-id="status"]');
      if (st) st.textContent = statusText;
    }
  }

  // createStory: POST structured body to server function and fallback to GET
  async function createStory(){
    setError('');
    showSpinner(true, 'Skapar…');
    try {
      const ageSel = qs('#age') || qs('[data-id="age"]');
      const lengthSel = qs('#length') || qs('[data-id="length"]');
      const heroEl = qs('#hero') || qs('[data-id="hero"]');
      const promptEl = qs('#prompt') || qs('[data-id="prompt"]');
      const storyEl = qs('[data-id="story"]') || qs('#story');

      if (!promptEl) { setError('Prompt-fält saknas.'); showSpinner(false); return; }
      const prompt = (promptEl && promptEl.value) ? promptEl.value.trim() : '';
      const hero = (heroEl && heroEl.value) ? heroEl.value.trim() : '';
      if (!prompt) { setError('Skriv vad sagan ska handla om.'); showSpinner(false); return; }

      const ageVal = ageSel ? ageSel.value : '';
      const ageRange = parseAgeValue(ageVal);
      const lengthVal = lengthSel ? lengthSel.value : '';

      const body = {
        prompt,
        heroName: hero || undefined,
        ageMin: ageRange ? ageRange.min : undefined,
        ageMax: ageRange ? ageRange.max : undefined,
        ageRange: ageVal || undefined,
        length: lengthVal || undefined
      };

      // POST to existing server function route. We expect functions/api/generate_story.js to handle POST.
      let res = null;
      try {
        res = await fetch('/api/generate_story', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(body)
        });
      } catch (err) {
        warn('POST /api/generate_story failed', err);
        res = null;
      }

      if (res && res.ok) {
        const data = await res.json().catch(()=>({}));
        const storyText = data.story || data?.content || data?.text || '';
        if (storyText) {
          if (storyEl) storyEl.textContent = storyText;
          showSpinner(false);
          return;
        }
        warn('POST returned ok but no story field', data);
      } else if (res && res.status === 405) {
        // Server refuses POST -> fall back to GET
        warn('Server returned 405 for POST /api/generate_story; falling back to GET');
      } else if (res && res.status) {
        // Non-OK response: log for debugging
        const txt = await res.text().catch(()=>'(no body)');
        warn('POST /api/generate_story status', res.status, txt);
      }

      // Fallback GET to same route (legacy support)
      const params = new URLSearchParams();
      if (ageRange) { params.set('ageMin', ageRange.min); params.set('ageMax', ageRange.max); }
      else if (ageVal) params.set('ageRange', ageVal);
      if (lengthVal) params.set('length', lengthVal);
      if (hero) params.set('hero', hero);
      params.set('prompt', prompt);
      const fallbackUrl = `/api/generate_story?${params.toString()}`;

      const res2 = await fetch(fallbackUrl);
      if (!res2.ok) {
        const txt = await res2.text().catch(()=>'(no body)');
        setError('Generering misslyckades: ' + (txt || ('HTTP ' + (res2.status||'err'))));
        showSpinner(false);
        return;
      }
      const ct = res2.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const j = await res2.json().catch(()=>null);
        const storyText2 = j?.story || j?.note || JSON.stringify(j);
        if (storyEl) storyEl.textContent = storyText2;
      } else {
        const txt = await res2.text();
        if (storyEl) storyEl.textContent = txt;
      }
    } catch (err) {
      setError('Fel: ' + String(err));
    } finally {
      showSpinner(false);
    }
  }

  // playTTS: try /api/tts first (R2 cache), fallback to /api/tts_vertex
  async function playTTS(){
    setError('');
    showSpinner(true, 'Spelar upp…');
    try {
      const storyEl = qs('[data-id="story"]') || qs('#story') || qs('.story-output');
      const audioEl = qs('[data-id="audio"]') || qs('audio');
      const playButton = qs('[data-id="btn-tts"]') || qs('#btn-tts');

      const text = (storyEl?.textContent || "").trim();
      if (!text) { setError('Ingen berättelse att läsa upp.'); showSpinner(false); return; }
      const voice = (qs('#voice')?.value || 'sv-SE-Wavenet-A');

      if (playButton) playButton.disabled = true;

      // Helper to play blob response
      async function playBlobResponse(res) {
        if (!res.ok) {
          const t = await res.text().catch(()=>'(no body)');
          throw new Error('TTS upstream failed: ' + (t || res.status));
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (audioEl) {
          audioEl.src = url;
          audioEl.play().catch(e => console.warn('audio play error', e));
        } else {
          new Audio(url).play().catch(e => console.warn('audio play error', e));
        }
      }

      // Try /api/tts (preferred: returns audio blob or JSON with audio info)
      try {
        let res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice, userId: window.getBNUserId ? window.getBNUserId() : undefined })
        });
        // If server returns JSON telling to use X-Audio-Key or URL, handle later; else assume blob
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          // JSON response — try parse fields (e.g., { ok:true, audio_url: "...", note:... } )
          const j = await res.json().catch(()=>null);
          if (j && j.audio_url) {
            // fetch audio_url as blob
            const r2 = await fetch(j.audio_url);
            if (!r2.ok) throw new Error('Failed to fetch audio_url');
            const b = await r2.blob();
            const url = URL.createObjectURL(b);
            if (audioEl) { audioEl.src = url; audioEl.play().catch(()=>{}); }
            else new Audio(url).play().catch(()=>{});
            if (playButton) playButton.disabled = false;
            showSpinner(false);
            return;
          } else if (j && j.ok && j.note && j.story) {
            // weird response: may be fallback text; show it
            if (storyEl && j.story) storyEl.textContent = j.story;
            if (playButton) playButton.disabled = false;
            showSpinner(false);
            return;
          } else {
            throw new Error('Unexpected JSON from /api/tts: ' + JSON.stringify(j).slice(0,200));
          }
        } else {
          // assume binary audio blob
          await playBlobResponse(res);
          if (playButton) playButton.disabled = false;
          showSpinner(false);
          return;
        }
      } catch (e1) {
        warn('[BN] /api/tts failed, trying /api/tts_vertex', e1);
      }

      // Fallback: /api/tts_vertex (older/alternate route)
      try {
        let res2 = await fetch('/api/tts_vertex', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice })
        });
        await playBlobResponse(res2);
        if (playButton) playButton.disabled = false;
        showSpinner(false);
        return;
      } catch (e2) {
        warn('[BN] /api/tts_vertex failed', e2);
        setError('Kunde inte skapa ljud: ' + (e2?.message || e2));
      }

    } catch (err) {
      setError('Ljudfel: ' + String(err));
    } finally {
      showSpinner(false);
      const playButton = qs('[data-id="btn-tts"]') || qs('#btn-tts');
      if (playButton) playButton.disabled = false;
    }
  }

  // Expose globally for inline binder
  window.createStory = createStory;
  window.playTTS = playTTS;

  // Bind UI buttons
  document.addEventListener('DOMContentLoaded', () => {
    const createBtn = qs('[data-id="btn-create"]') || qs('#btn-create');
    const playBtn = qs('[data-id="btn-tts"]') || qs('#btn-tts');
    if (createBtn) createBtn.addEventListener('click', (e)=>{ e.preventDefault(); createStory(); });
    if (playBtn) playBtn.addEventListener('click', (e)=>{ e.preventDefault(); playTTS(); });

    const useT = qs('#use-transcript');
    const transcript = qs('#transcript');
    const prompt = qs('#prompt');
    if (useT && transcript && prompt) {
      useT.addEventListener('click', ()=>{ prompt.value = transcript.value || prompt.value; });
    }
  });

  // Log loaded
  log('public/app.js loaded — createStory and playTTS exposed');
})();
