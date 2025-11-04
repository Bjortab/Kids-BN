// public/save_client.js
// Klientkod som automatiskt sparar sagor efter att window.createStory() körts.
// Den här versionen skickar även senaste ljudinspelningen (om tillgänglig) som audioBase64
// i samma POST till /api/save_story så både text + originalinspelning sparas server-side (D1 + R2).
//
// Beteende:
// - Wrapper runt window.createStory(): efter att sagan genererats försöker vi spara
//   prompt, transcript, story, ageRange, heroName samt audio (om window.__bn_lastRecordingBlob finns).
// - Om server-sparandet misslyckas sparas fallback i localStorage under 'bn_last_story'.
// - Exponerar window.saveCurrentStory() för manuellt sparande och window.restoreLastFallback() för återställning.
//
// OBS: Large audio som base64 kan bli stora. Recorder begränsar inspelningstiden (rekommenderat max ~60s).
// Om ni vill kan vi istället ändra till multipart upload eller presigned R2‑upload senare.

(function(){
  'use strict';

  // ---------- Hjälpselectorer (ändra om din HTML skiljer) ----------
  function qs(sel){ try { return document.querySelector(sel); } catch(e){ return null; } }
  function getUIValues() {
    const age = qs('#age')?.value || qs('[data-id="age"]')?.value || '';
    const hero = qs('#hero')?.value || qs('[data-id="hero"]')?.value || '';
    const prompt = (qs('#prompt')?.value || qs('[data-id="prompt"]')?.value || '').trim();
    const transcript = (qs('[data-id="transcript"]')?.value || qs('#transcript')?.value || '').trim();
    const story = (qs('[data-id="story"]')?.textContent || qs('#story')?.textContent || '').trim();
    return { age, hero, prompt, transcript, story };
  }

  // ---------- Blob -> dataURL (base64) ----------
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      if (!blob) return resolve(null);
      try {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = (e) => reject(e);
        fr.readAsDataURL(blob);
      } catch (e) {
        reject(e);
      }
    });
  }

  // ---------- Save to server (POST JSON) ----------
  async function saveToServer(payload) {
    try {
      const res = await fetch('/api/save_story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const txt = await res.text().catch(()=>'<no-body>');
        console.warn('save_story failed', res.status, txt);
        throw new Error('save failed: ' + res.status);
      }
      const json = await res.json().catch(()=>null);
      console.log('Saved story to server', json);
      // On success remove fallback
      try { localStorage.removeItem('bn_last_story'); } catch(e){}
      return json;
    } catch (err) {
      console.warn('Save to server failed, saving to localStorage as fallback', err);
      try {
        localStorage.setItem('bn_last_story', JSON.stringify(Object.assign({ saved_at: Date.now() }, payload)));
      } catch(e) {
        console.error('localStorage save failed', e);
      }
      return { ok: false, fallback: true, error: String(err) };
    }
  }

  // ---------- Public function: saveCurrentStory ----------
  window.saveCurrentStory = async function() {
    const ui = getUIValues();
    if (!ui.story && !ui.prompt) {
      console.warn('Nothing to save (no story or prompt).');
      return { ok: false, error: 'empty' };
    }

    const payload = {
      prompt: ui.prompt,
      transcript: ui.transcript,
      story: ui.story,
      ageRange: ui.age,
      heroName: ui.hero
    };

    // If recorder has exposed last recording blob, include it
    const lastBlob = window.__bn_lastRecordingBlob || null;
    if (lastBlob && lastBlob instanceof Blob) {
      try {
        const dataUrl = await blobToDataURL(lastBlob);
        if (dataUrl) {
          payload.audioBase64 = dataUrl; // data:<type>;base64,...
          payload.audioContentType = lastBlob.type || 'audio/webm';
        }
      } catch (e) {
        console.warn('Failed to convert audio blob to base64', e);
      }
    }

    return await saveToServer(payload);
  };

  // ---------- Wrap createStory so saving sker automatiskt efter generering ----------
  (function wrapCreateStory() {
    const original = window.createStory;
    if (typeof original !== 'function') {
      console.warn('window.createStory not found — auto-save will not run. Use saveCurrentStory() manually.');
      return;
    }

    window.createStory = async function(...args) {
      const result = await original.apply(this, args);
      try {
        // small delay so UI updates render (if needed)
        await new Promise(r => setTimeout(r, 250));
        const res = await window.saveCurrentStory();
        if (res && res.ok) {
          console.info('Auto-saved story', res);
        } else if (res && res.fallback) {
          console.info('Auto-save used fallback (localStorage).');
        } else {
          console.info('Auto-save response', res);
        }
      } catch (e) {
        console.warn('Auto-save after createStory failed', e);
      }
      return result;
    };
    console.log('createStory wrapped for auto-save (incl. audio if available).');
  })();

  // ---------- Restore fallback helper ----------
  window.restoreLastFallback = function() {
    try {
      const raw = localStorage.getItem('bn_last_story');
      if (!raw) { console.info('No local fallback found'); return null; }
      const obj = JSON.parse(raw);
      // Populate UI if possible
      try {
        if (obj.prompt) {
          const p = qs('#prompt') || qs('[data-id="prompt"]') || qs('textarea[name="prompt"]');
          if (p) { if ('value' in p) p.value = obj.prompt; else p.textContent = obj.prompt; p.dispatchEvent(new Event('input',{bubbles:true})); }
        }
        if (obj.transcript) {
          const t = qs('[data-id="transcript"]') || qs('#transcript') || qs('textarea[name="transcript"]');
          if (t) { if ('value' in t) t.value = obj.transcript; else t.textContent = obj.transcript; t.dispatchEvent(new Event('input',{bubbles:true})); }
        }
        if (obj.story) {
          const s = qs('[data-id="story"]') || qs('#story');
          if (s) s.textContent = obj.story;
        }
      } catch(e){
        console.warn('Failed to populate UI from fallback', e);
      }
      console.info('Restored local fallback (bn_last_story).');
      return obj;
    } catch (e) {
      console.warn('restoreLastFallback error', e);
      return null;
    }
  };

  // ---------- On load: inform if local fallback exists ----------
  try {
    const fallback = localStorage.getItem('bn_last_story');
    if (fallback) console.info('Found local fallback saved story in localStorage (bn_last_story). Use restoreLastFallback() to restore it.');
  } catch(e){}

})();
