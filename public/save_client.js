// public/save_client.js
// Klient: skapar anonym user-id (localStorage), injicerar userId i /api/generate anrop,
// wrapper runt createStory för auto‑save inkl. audio (om available), och fallback till localStorage.

(function(){
  'use strict';
  function qs(sel){ try { return document.querySelector(sel); } catch(e){ return null; } }

  function getOrCreateUserId() {
    try {
      let id = localStorage.getItem('bn_user_id');
      if (id) return id;
      id = 'bn_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
      localStorage.setItem('bn_user_id', id);
      return id;
    } catch(e){ return ''; }
  }
  const BN_USER_ID = getOrCreateUserId();
  window.getBNUserId = function(){ return BN_USER_ID; };

  // Wrap fetch to inject userId for /api/generate and /api/generate_story
  const origFetch = window.fetch.bind(window);
  window.fetch = async function(input, init) {
    try {
      let url = (typeof input === 'string') ? input : input.url;
      const method = (init && init.method) ? init.method.toUpperCase() : (typeof input === 'object' && input.method ? input.method.toUpperCase() : 'GET');
      if (method === 'POST' && typeof url === 'string' && (url.endsWith('/api/generate') || url.endsWith('/api/generate/') || url.endsWith('/generate') || url.endsWith('/generate/'))) {
        let newInit = Object.assign({}, init || {});
        const headers = Object.assign({}, newInit.headers || {});
        let bodyText = '';
        if (headers['Content-Type'] && headers['Content-Type'].includes('application/json')) {
          bodyText = newInit.body || '{}';
        } else {
          if (typeof input === 'object' && input instanceof Request) {
            const clone = input.clone();
            const ct = (clone.headers.get('content-type')||'').toLowerCase();
            if (ct.includes('application/json')) bodyText = await clone.text();
            else bodyText = newInit.body || '{}';
          } else {
            bodyText = newInit.body || '{}';
          }
        }
        let payload = {};
        try { payload = JSON.parse(bodyText || '{}'); } catch(e){ payload = {}; }
        payload.userId = BN_USER_ID;
        newInit.body = JSON.stringify(payload);
        newInit.headers = Object.assign(headers, { 'Content-Type': 'application/json' });
        return origFetch(url, newInit);
      }
    } catch(e){ console.warn('[save_client] fetch wrapper error', e); }
    return origFetch(input, init);
  };

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      if (!blob) return resolve(null);
      try {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = (e) => reject(e);
        fr.readAsDataURL(blob);
      } catch(e){ reject(e); }
    });
  }

  function getUIValues() {
    const age = qs('#age')?.value || qs('[data-id="age"]')?.value || '';
    const hero = qs('#hero')?.value || qs('[data-id="hero"]')?.value || '';
    const prompt = (qs('#prompt')?.value || qs('[data-id="prompt"]')?.value || '').trim();
    const transcript = (qs('[data-id="transcript"]')?.value || qs('#transcript')?.value || '').trim();
    const story = (qs('[data-id="story"]')?.textContent || qs('#story')?.textContent || '').trim();
    return { age, hero, prompt, transcript, story };
  }

  async function saveToServer(payload) {
    try {
      const res = await fetch('/api/save_story', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { const txt = await res.text().catch(()=>'<no-body>'); throw new Error('save failed: '+txt); }
      const json = await res.json().catch(()=>null);
      try { localStorage.removeItem('bn_last_story'); } catch(e){}
      return json;
    } catch (err) {
      console.warn('Save to server failed, saving to localStorage', err);
      try { localStorage.setItem('bn_last_story', JSON.stringify(Object.assign({ saved_at: Date.now() }, payload))); } catch(e){}
      return { ok:false, fallback:true, error: String(err) };
    }
  }

  window.saveCurrentStory = async function() {
    const ui = getUIValues();
    if (!ui.story && !ui.prompt) return { ok:false, error:'empty' };
    const payload = { prompt: ui.prompt, transcript: ui.transcript, story: ui.story, ageRange: ui.age, heroName: ui.hero, userId: BN_USER_ID };

    const lastBlob = window.__bn_lastRecordingBlob || null;
    if (lastBlob && lastBlob instanceof Blob) {
      try {
        const dataUrl = await blobToDataURL(lastBlob);
        if (dataUrl) { payload.audioBase64 = dataUrl; payload.audioContentType = lastBlob.type || 'audio/webm'; }
      } catch(e){ console.warn('Failed to convert audio blob to base64', e); }
    }
    return await saveToServer(payload);
  };

  (function wrapCreateStory() {
    const original = window.createStory;
    if (typeof original !== 'function') { console.warn('window.createStory not found — auto-save will not run automatically.'); return; }
    window.createStory = async function(...args) {
      const result = await original.apply(this, args);
      try { await new Promise(r=>setTimeout(r,250)); const res = await window.saveCurrentStory(); console.info('Auto-save result', res); } catch(e){ console.warn('Auto-save after createStory failed', e); }
      return result;
    };
    console.log('createStory wrapped for auto-save (userId injected automatically).');
  })();

  window.restoreLastFallback = function() {
    try {
      const raw = localStorage.getItem('bn_last_story');
      if (!raw) { console.info('No local fallback found'); return null; }
      const obj = JSON.parse(raw);
      try {
        if (obj.prompt) { const p = qs('#prompt') || qs('[data-id="prompt"]'); if (p) { if ('value' in p) p.value = obj.prompt; else p.textContent = obj.prompt; p.dispatchEvent(new Event('input',{bubbles:true})); } }
        if (obj.transcript) { const t = qs('[data-id="transcript"]') || qs('#transcript'); if (t) { if ('value' in t) t.value = obj.transcript; else t.textContent = obj.transcript; t.dispatchEvent(new Event('input',{bubbles:true})); } }
        if (obj.story) { const s = qs('[data-id="story"]') || qs('#story'); if (s) s.textContent = obj.story; }
      } catch(e){ console.warn('Failed to populate UI from fallback', e); }
      console.info('Restored local fallback (bn_last_story).');
      return obj;
    } catch(e){ console.warn('restoreLastFallback error', e); return null; }
  };
})();
