// public/app.js
// Komplett app.js med playTTS uppdaterad för att anropa /api/tts (cache-aware) först.
// Klistra in som public/app.js (ersätt befintlig).

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
    const spinnerEl = qs('[data-id="spinner"]') || qs('.spinner') || null;
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
          if (storyEl) storyEl.textContent = data.story;
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
        if (storyEl) storyEl.textContent = data2.story;
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

  // Spela upp TTS — försöker /api/tts (cache-aware) först, fallback till tts_vertex
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

      // Försök /api/tts (cache-aware) först
      try {
        let res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice, userId: (window.getBNUserId ? window.getBNUserId() : undefined) })
        });
        if (!res.ok) throw new Error('tts ' + res.status);
        
        // Check for X-Audio-Key header to use CDN-cached audio
        const audioKey = res.headers.get('X-Audio-Key');
        let audioUrl;
        
        if (audioKey) {
          // Use /api/get_audio to fetch from R2 with better CDN caching
          log('Using cached audio from R2:', audioKey);
          try {
            const audioRes = await fetch(`/api/get_audio?key=${encodeURIComponent(audioKey)}`);
            if (audioRes.ok) {
              const blob = await audioRes.blob();
              audioUrl = URL.createObjectURL(blob);
            } else {
              // get_audio failed, consume original response as fallback
              log('get_audio failed, falling back to blob');
              const blob = await res.blob();
              audioUrl = URL.createObjectURL(blob);
            }
          } catch (e) {
            // get_audio error, consume original response as fallback
            log('get_audio error, falling back to blob:', e);
            const blob = await res.blob();
            audioUrl = URL.createObjectURL(blob);
          }
        } else {
          // No X-Audio-Key header, use blob response directly
          const blob = await res.blob();
          audioUrl = URL.createObjectURL(blob);
        }
        
        // Play audio
        const audioEl = qs('[data-id="audio"]') || qs('audio');
        if (audioEl) {
          audioEl.src = audioUrl;
          audioEl.play().catch(e => console.warn('play error', e));
        } else {
          new Audio(audioUrl).play().catch(e => console.warn('play error', e));
        }
        
        // Debug: logga headers så du ser X-Audio-Key och varning
        try { console.info('tts headers', 'X-Audio-Key=', res.headers.get('X-Audio-Key'), 'X-Cost-Warning=', res.headers.get('X-Cost-Warning')); } catch(e){}
        return;
      } catch (e1) {
        console.warn('[BN] /api/tts failed, falling back to tts_vertex', e1);
      }

      // Fallback till /api/tts_vertex (om du har den äldre enda)
      try {
        let res = await fetch("/api/tts_vertex", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice })
        });
        if (!res.ok) throw new Error('tts_vertex ' + res.status);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audioEl = qs('[data-id="audio"]') || qs('audio');
        if (audioEl) {
          audioEl.src = url;
          audioEl.play().catch(e => console.warn('play error', e));
        } else {
          new Audio(url).play().catch(e => console.warn('play error', e));
        }
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

  // Exponera globalt (för inline HTML eller snabbtest)
  window.createStory = createStory;
  window.playTTS = playTTS;

  log("app.js laddad");
})();
