// public/app.js (restored + length selection handling)
// Client glue: createStory + playTTS — place this file at public/app.js
(function(){
  'use strict';

  const log = (...args) => console.log('[BN]', ...args);
  const warn = (...args) => console.warn('[BN]', ...args);

  function qs(sel){ try { return document.querySelector(sel); } catch(e){ return null; } }

  function findButtonByText(...terms){
    const lower = t => t.toLowerCase();
    const btns = Array.from(document.querySelectorAll('button,input[type=button],input[type=submit]'));
    return btns.find(b => terms.some(term => (b.value||b.innerText||'').toLowerCase().includes(lower(term))));
  }

  let playBtn   = qs('[data-id="btn-tts"]')   || findButtonByText('läs upp','spela','testa röst');
  let createBtn = qs('[data-id="btn-create"]') || findButtonByText('skapa saga','skapa & läs upp','skapa');

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

  function lengthToMinutes(len){
    if (!len) return 5;
    if (len === 'short') return 2;
    if (len === 'medium') return 5;
    if (len === 'long') return 12;
    return 5;
  }

  async function createStory() {
    const ageEl    = qs('#age') || qs('[data-id="age"]') || null;
    const heroEl   = qs('#hero') || qs('[data-id="hero"]') || null;
    const promptEl = qs('#prompt') || qs('[data-id="prompt"]') || qs('textarea[name="prompt"]') || null;
    const lengthSel = qs('#length') || qs('[data-id="length"]') || null;
    const storyEl  = qs('[data-id="story"]') || qs('#story') || qs('.story-output') || null;
    const createButton = qs('[data-id="btn-create"]') || qs('#btn-create') || qs('.btn-primary') || createBtn || null;

    try {
      setError('');
      if (!promptEl) { setError('Prompt-fält saknas.'); return; }
      const age    = (ageEl?.value || '7-8 år').trim();
      const hero   = (heroEl?.value || '').trim();
      const prompt = (promptEl?.value || '').trim();
      const length = (lengthSel?.value || 'medium');

      if (!prompt) { setError('Skriv eller tala in en idé först.'); return; }

      showSpinner(true, 'Skapar berättelse…');
      if (createButton) createButton.disabled = true;

      const mins = lengthToMinutes(length);
      const lvl = 3;
      const lang = 'sv';
      const body = { lvl, mins, lang, prompt, ageRange: age, heroName: hero };

      // Försök v2 först (POST JSON)
      let res = await fetch("/api/generate_story", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        let data = null;
        try {
          data = await res.clone().json();
        } catch (parseErr) {
          const txt = await res.text().catch(()=>'(kunde inte läsa body)');
          console.warn('[BN] generate_story returned non-JSON:', res.status, txt);
          throw new Error('Server svarade inte med JSON: ' + (txt.slice ? txt.slice(0,300) : String(txt)));
        }

        if (data?.story || data?.text) {
          const textVal = data.story || data.text || '';
          if (storyEl) storyEl.textContent = textVal;
          return;
        }
        console.warn('[BN] generate_story ok men saknar story‑fält:', data);
      } else {
        const txt = await res.text().catch(()=>'(no body)');
        console.warn('[BN] generate_story failed', res.status, txt);
      }

      // Fallback till /api/generate
      const url = `/api/generate?ageRange=${encodeURIComponent(age)}&hero=${encodeURIComponent(hero)}&prompt=${encodeURIComponent(prompt)}&mins=${encodeURIComponent(mins)}`;
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
        return;
      } catch (e1) {
        console.warn('[BN] tts_vertex failed', e1);
      }

      try {
        let res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice })
        });
        if (!res.ok) throw new Error('tts ' + res.status);
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

  if (!createBtn) warn("Hittar ingen 'Skapa saga'-knapp. Kontrollera data-id eller knapptext.");
  else createBtn.addEventListener("click", (e) => { e.preventDefault?.(); createStory(); });

  if (!playBtn) warn("Hittar ingen 'Läs upp'-knapp. Kontrollera data-id eller knapptext.");
  else playBtn.addEventListener("click", (e) => { e.preventDefault?.(); playTTS(); });

  window.createStory = createStory;
  window.playTTS = playTTS;

  log("app.js laddad");
})();
