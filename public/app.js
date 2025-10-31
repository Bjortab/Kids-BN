// public/app.js — uppdaterad bindning och robust felhantering
// (ersätter tidigare app.js med stabilare selectors, spinnerhantering och felsökning)

(function () {
  const qs = (s) => document.querySelector(s);
  const qsa = (s) => Array.from(document.querySelectorAll(s));
  const log = (...a) => console.log("[BN]", ...a);
  const warn = (...a) => console.warn("[BN]", ...a);
  const lower = (t = "") => (t || "").toLowerCase().trim();

  // Fallback-sök via knapptext (behålls som slutgiltigt fallback)
  function findButtonByText(...needles) {
    const btns = qsa('button, input[type="button"], input[type="submit"]');
    return btns.find(b => needles.some(n => lower(b.value || b.innerText).includes(lower(n))));
  }

  // Robust selectors — försök först via data-id, sedan via text
  const createBtn = qs('[data-id="btn-create"]') || findButtonByText('skapa saga', 'skapa & läs upp', 'skapa');
  const playBtn   = qs('[data-id="btn-tts"]')   || findButtonByText('läs upp', 'spela', 'testa röst');

  const ageEl    = qs('#age') || qs('[data-id="age"]') || null;
  const heroEl   = qs('#hero') || qs('[data-id="hero"]') || null;
  const promptEl = qs('#prompt') || qs('[data-id="prompt"]') || qs('textarea[name="prompt"]') || null;
  const storyEl  = qs('[data-id="story"]') || qs('#story') || qs('.story-output') || null;
  const spinnerEl = qs('[data-id="spinner"]') || qs('.spinner') || null;
  const errorEl = qs('[data-id="error"]') || qs('.error') || null;
  const audioEl = qs('[data-id="audio"]') || qs('audio');

  function setError(text) {
    if (!errorEl) return console.error('[BN] error:', text);
    errorEl.style.display = text ? 'block' : 'none';
    errorEl.textContent = text || '';
  }

  function showSpinner(show, statusText) {
    try {
      if (!spinnerEl) return;
      spinnerEl.style.display = show ? 'flex' : 'none';
      const status = spinnerEl.querySelector('[data-id="status"]');
      if (status && typeof statusText !== 'undefined') status.textContent = statusText;
    } catch (e) { console.warn('[BN] spinner error', e); }
  }

  async function createStory() {
    // Basic validation
    try {
      setError('');
      if (!promptEl) { setError('Prompt-fält saknas.'); return; }
      const age    = (ageEl?.value || '3-4 år').trim();
      const hero   = (heroEl?.value || '').trim();
      const prompt = (promptEl?.value || '').trim();
      if (!prompt) { setError('Skriv eller tala in en idé först.'); return; }

      showSpinner(true, 'Skapar berättelse…');
      if (createBtn) createBtn.disabled = true;

      // Försök v2 först (POST JSON)
      let res = await fetch("/api/generate_story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ageRange: age, heroName: hero, prompt })
      });

      if (res.ok) {
        const data = await res.json();
        if (data?.story) {
          if (storyEl) storyEl.textContent = data.story;
          return;
        }
        // fortsätt till fallback om inget story-field
      } else {
        // Logga för debugging
        const txt = await res.text().catch(()=>'');
        console.warn('[BN] generate_story returned', res.status, txt);
        // continue to fallback
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
      if (createBtn) createBtn.disabled = false;
    }
  }

  async function playTTS() {
    try {
      setError('');
      const text = (storyEl?.textContent || "").trim();
      if (!text) { setError('Ingen berättelse att läsa upp.'); return; }
      const voice = (qs('#voice')?.value || 'sv-SE-Wavenet-A');

      showSpinner(true, 'Spelar upp…');
      if (playBtn) playBtn.disabled = true;

      // Försök tts_vertex först
      try {
        let res = await fetch("/api/tts_vertex", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice })
        });
        if (!res.ok) throw new Error('tts_vertex ' + res.status);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (audioEl) {
          audioEl.src = url;
          audioEl.play().catch(e => console.warn('play error', e));
        } else {
          new Audio(url).play().catch(e => console.warn('play error', e));
        }
        return;
      } catch (e1) {
        console.warn('[BN] tts_vertex failed', e1);
      }

      // Fallback till /api/tts
      try {
        let res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice })
        });
        if (!res.ok) throw new Error('tts ' + res.status);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
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
      if (playBtn) playBtn.disabled = false;
    }
  }

  // Bind events (if not found, log)
  if (!createBtn) warn("Hittar ingen 'Skapa saga'-knapp. Kontrollera data-id eller knapptext.");
  else createBtn.addEventListener("click", (e) => { e.preventDefault?.(); createStory(); });

  if (!playBtn) warn("Hittar ingen 'Läs upp'-knapp. Kontrollera data-id eller knapptext.");
  else playBtn.addEventListener("click", (e) => { e.preventDefault?.(); playTTS(); });

  // Exponera globalt (för inline HTML eller snabbtest)
  window.createStory = createStory;
  window.playTTS = playTTS;

  log("app.js (stabil) laddad");
})();
