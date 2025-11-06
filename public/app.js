// APP VERSION: 1.0.0
// BUILD: 2025-11-06
// CHANGES: playTTS prefers X-Audio-Key -> /api/get_audio?key=... (CDN/cached). Added safe audio playback to avoid AbortError.
// MAINTAINER: Bjortab
const APP_VERSION = '1.0.0';
const APP_BUILD = '2025-11-06';
console.info(`[BN app] version=${APP_VERSION} build=${APP_BUILD}`);

(function(){
  'use strict';

  const log = (...args) => console.log('[BN]', ...args);
  const warn = (...args) => console.warn('[BN]', ...args);

  // Enkelt query helper
  function qs(sel){ try { return document.querySelector(sel); } catch(e){ return null; } }

  // Hitta knapp via text (flera alternativ)
  function findButtonByText(...terms){
    const lower = t => t.toLowerCase();
    const btns = Array.from(document.querySelectorAll('button,input[type=button],input[type=submit]'));
    return btns.find(b => terms.some(term => (b.value||b.innerText||'').toLowerCase().includes(lower(term))));
  }

  // Grundläggande element (kan vara null initialt — createStory läser DOM igen vid anrop)
  let playBtn   = qs('[data-id="btn-tts"]')   || findButtonByText('läs upp','spela','testa röst');
  let createBtn = qs('[data-id="btn-create"]') || findButtonByText('skapa saga','skapa & läs upp','skapa');

  // Hjälpfunktioner som UI använder
  function setError(text){
    const errorEl = qs('[data-id="error"]') || qs('.error');
    if (!errorEl) return console.error('[BN] error:', text);
    errorEl.style.display = text ? 'block' : 'none';
    errorEl.textContent = text || '';
  }

  function showSpinner(show, statusText){
    try {
      const spinnerEl = qs('[data-id="spinner"]') || qs('.spinner');
      if (!spinnerEl) return;
      spinnerEl.style.display = show ? 'flex' : 'none';
      const status = spinnerEl.querySelector('[data-id="status"]');
      if (status && typeof statusText !== 'undefined') status.textContent = statusText;
    } catch (e) { console.warn('[BN] spinner error', e); }
  }

  // Robust createStory: läser DOM varje gång funktionen körs (för att undvika load-order problem)
  async function createStory() {
    // Läs DOM‑element här så funktionen fungerar oavsett när app.js kördes
    const ageEl    = qs('#age') || qs('[data-id="age"]') || null;
    const heroEl   = qs('#hero') || qs('[data-id="hero"]') || null;
    const promptEl = qs('#prompt') || qs('[data-id="prompt"]') || qs('textarea[name="prompt"]') || null;
    const storyEl  = qs('[data-id="story"]') || qs('#story') || qs('.story-output') || null;
    const createButton = qs('[data-id="btn-create"]') || qs('#btn-create') || qs('.btn-primary') || createBtn || null;

    try {
      setError('');
      if (!promptEl) { setError('Prompt-fält saknas.'); return; }
      const age    = (ageEl?.value || '3-4 år').trim();
      const hero   = (heroEl?.value || '').trim();
      const prompt = (promptEl?.value || '').trim();
      if (!prompt) { setError('Skriv eller tala in en idé först.'); return; }

      showSpinner(true, 'Skapar berättelse…');
      if (createButton) createButton.disabled = true;

      // Försök v2 först (POST JSON) — vi ber också om JSON i Accept
      let res = await fetch("/api/generate_story", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({ ageRange: age, heroName: hero, prompt })
      });

      // Om status OK försök parse JSON, men fånga parsingfel och visa texten från servern
      if (res.ok) {
        let data = null;
        try {
          data = await res.clone().json();
        } catch (parseErr) {
          // Om parse misslyckas, hämta text och visa i error‑fältet (diagnostik)
          const txt = await res.text().catch(()=>'(kunde inte läsa body)');
          console.warn('[BN] generate_story returned non-JSON:', res.status, txt);
          throw new Error('Server svarade inte med JSON: ' + (txt.slice ? txt.slice(0,300) : String(txt)));
        }

        if (data?.story) {
          const storyElLocal = storyEl || qs('[data-id="story"]') || qs('#story') || qs('.story-output');
          if (storyElLocal) storyElLocal.textContent = data.story;
          return;
        }
        // Om format avviker, logga och fortsätt fallback
        console.warn('[BN] generate_story ok men saknar story‑fält:', data);
      } else {
        // res.ok = false, få text för debugging
        const txt = await res.text().catch(()=>'(no body)');
        console.warn('[BN] generate_story failed', res.status, txt);
        // fortsätt till fallback
      }

      // Fallback till v1 (GET with query)
      const url = `/api/generate?ageRange=${encodeURIComponent(age)}&hero=${encodeURIComponent(hero)}&prompt=${encodeURIComponent(prompt)}`;
      const res2 = await fetch(url);
      if (!res2.ok) {
        const t = await res2.text().catch(()=>'');
        throw new Error('Båda endpoints misslyckades: ' + (t || res2.status));
      }
      const data2 = await res2.json();
      if (data2?.story) {
        const storyElLocal = storyEl || qs('[data-id="story"]') || qs('#story') || qs('.story-output');
        if (storyElLocal) storyElLocal.textContent = data2.story;
        return;
      }

      throw new Error('Inget story i svar från v1');
    } catch (err) {
      console.error('[BN] createStory error', err);
      setError('Kunde inte skapa berättelse: ' + (err?.message || err));
    } finally {
      showSpinner(false);
      try { if (createButton) createButton.disabled = false; } catch(e){}
    }
  }

  // --- Safe audio helpers and replacement for playTTSResponse / playTTS ---
  // Global guard to prevent concurrent plays
  let __bn_audio_lock = { active: false, id: 0 };

  /**
   * Safely set src and play an audio element.
   * Waits for canplaythrough (or timeout) before calling play().
   */
  async function safeSetSrcAndPlay(audioEl, audioUrl, options = {}) {
    const timeoutMs = options.timeoutMs || 2500;

    try {
      // If same source already set, just attempt play once
      if (audioEl.currentSrc && audioEl.currentSrc.includes(audioUrl)) {
        console.debug('[SAFE] same src, calling play');
        await audioEl.play().catch(e => console.warn('[SAFE] play failed', e));
        return;
      }

      // Stop any previous loading/playing
      try { audioEl.pause(); } catch (e){}

      // Remove src and load to abort previous network fetch
      audioEl.removeAttribute('src');
      try { audioEl.load(); } catch(e){}

      // Set new source
      audioEl.src = audioUrl;
      audioEl.preload = 'auto';

      // Wait for canplaythrough or timeout
      await new Promise((resolve) => {
        let done = false;
        function clean() {
          if (done) return;
          done = true;
          audioEl.removeEventListener('canplaythrough', onReady);
        }
        function onReady() { clean(); resolve(); }
        audioEl.addEventListener('canplaythrough', onReady);
        // Fallback timeout
        setTimeout(() => { clean(); resolve(); }, timeoutMs);
      });

      // Try to play
      await audioEl.play().catch(e => {
        console.warn('[SAFE] play failed after ready', e);
      });
    } catch (err) {
      console.error('[SAFE] safeSetSrcAndPlay error', err);
    }
  }

  /**
   * Handle a fetch Response from /api/tts or /api/tts_vertex.
   * If header X-Audio-Key exists, uses /api/get_audio?key=... (cached),
   * otherwise falls back to blob playback.
   */
  async function playTTSResponse(res) {
    if (!res || !res.ok) {
      console.warn('[BN] TTS response error', res && res.status);
      return;
    }

    const audioKey = res.headers.get('X-Audio-Key');
    let audioEl = qs('[data-id="audio"]') || qs('audio') || new Audio();

    if (!audioEl.parentElement) {
      audioEl.setAttribute('data-id', 'audio');
      audioEl.setAttribute('controls', '');
      document.body.appendChild(audioEl);
    }

    // Acquire simple lock to avoid concurrent source swaps
    const myId = ++__bn_audio_lock.id;
    if (__bn_audio_lock.active) {
      // Another play in progress — politely wait a short while to avoid stomping it
      console.debug('[BN] waiting for existing play lock');
      await new Promise(r => setTimeout(r, 150));
    }
    __bn_audio_lock.active = true;

    try {
      if (audioKey) {
        const audioUrl = `/api/get_audio?key=${encodeURIComponent(audioKey)}`;
        await safeSetSrcAndPlay(audioEl, audioUrl, { timeoutMs: 2500 });
        return;
      }

      // No audio key — read blob and play
      try {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        await safeSetSrcAndPlay(audioEl, url, { timeoutMs: 2500 });
        // revoke after some time
        setTimeout(()=> URL.revokeObjectURL(url), 60000);
      } catch (err) {
        console.error('[BN] fallback play error', err);
      }
    } finally {
      // release lock (only if this caller is last)
      if (myId === __bn_audio_lock.id) __bn_audio_lock.active = false;
    }
  }

  /**
   * playTTS: sends request(s) to server and delegates playback to playTTSResponse
   */
  async function playTTS() {
    try {
      setError('');
      const storyEl = qs('[data-id="story"]') || qs('#story') || qs('.story-output');
      const text = (storyEl?.textContent || "").trim();
      if (!text) { setError('Ingen berättelse att läsa upp.'); return; }
      const voice = (qs('#voice')?.value || 'sv-SE-Wavenet-A');

      showSpinner(true, 'Spelar upp…');
      const playButton = qs('[data-id="btn-tts"]') || playBtn || qs('.btn-muted');
      if (playButton) playButton.disabled = true;

      // Try cache-aware endpoint first
      try {
        let res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice, userId: (window.getBNUserId ? window.getBNUserId() : undefined) })
        });
        if (!res.ok) throw new Error('tts ' + res.status);

        await playTTSResponse(res);
        return;
      } catch (e1) {
        console.warn('[BN] /api/tts failed or no cached key, falling back to tts_vertex', e1);
      }

      // Fallback to legacy TTS endpoint
      try {
        let res = await fetch("/api/tts_vertex", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice })
        });
        if (!res.ok) throw new Error('tts_vertex ' + res.status);
        await playTTSResponse(res);
      } catch (e2) {
        console.error('[BN] playTTS error', e2);
        setError('Kunde inte spela upp ljud: ' + (e2?.message || e2));
      }
    } finally {
      showSpinner(false);
      const playButton = qs('[data-id="btn-tts"]') || playBtn || qs('.btn-muted');
      if (playButton) playButton.disabled = false;
    }
  }

  // Bind events (om inte finns, logga och försök binda senare)
  if (!createBtn) warn("Hittar ingen 'Skapa saga'-knapp. Kontrollera data-id eller knapptext.");
  else createBtn.addEventListener("click", (e) => { e.preventDefault?.(); createStory(); });

  if (!playBtn) warn("Hittar ingen 'Läs upp'-knapp. Kontrollera data-id eller knapptext.");
  else playBtn.addEventListener("click", (e) => { e.preventDefault?.(); playTTS(); });

  // Exponera globalt (för inline HTML eller andra moduler)
  window.createStory = createStory;
  window.playTTS = playTTS;
  window.playTTSResponse = playTTSResponse;

  log("app.js laddad");
})();
