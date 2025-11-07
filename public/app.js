// public/app.js — komplett fil (ersätter befintlig).
// Viktigt: POST to /api/generate_story (exists in functions/api/generate_story.js).
// Parses single year ("1" or "2") or ranges ("3-4"), sends ageMin/ageMax + length.

(function(){
  'use strict';
  const log = (...a) => console.log('[BN]', ...a);
  const warn = (...a) => console.warn('[BN]', ...a);

  function qs(sel){ try { return document.querySelector(sel); } catch(e){ return null; } }

  // parse age value which can be "1" or "2" or "3-4"
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
    if (statusText) {
      const st = s.querySelector('[data-id="status"]');
      if (st) st.textContent = statusText;
    }
  }

  async function createStory(){
    setError('');
    showSpinner(true, 'Skapar…');
    try {
      const ageSel = qs('#age');
      const lengthSel = qs('#length');
      const heroEl = qs('#hero');
      const promptEl = qs('#prompt');
      const prompt = (promptEl && promptEl.value) ? promptEl.value.trim() : '';
      const hero = (heroEl && heroEl.value) ? heroEl.value.trim() : '';
      if (!prompt) { setError('Skriv vad sagan ska handla om.'); showSpinner(false); return; }

      const ageVal = ageSel ? ageSel.value : '';
      const ageRange = parseAgeValue(ageVal);
      const lengthVal = lengthSel ? lengthSel.value : '';

      // Structured body for POST
      const body = {
        prompt,
        heroName: hero || undefined,
        ageMin: ageRange ? ageRange.min : undefined,
        ageMax: ageRange ? ageRange.max : undefined,
        ageRange: ageVal || undefined, // legacy fallback
        length: lengthVal || undefined
      };

      // POST to existing function route /api/generate_story
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
        const storyText = data.story || data?.content || data?.text || (data.ok && data.fallback) || '';
        if (storyText) {
          const el = qs('[data-id="story"]');
          if (el) el.textContent = storyText;
          showSpinner(false);
          return;
        }
        warn('POST returned ok but no story field', data);
      } else if (res && res.status === 405) {
        warn('Server returned 405 for POST /api/generate_story; will fallback to GET');
      }

      // Fallback: GET to /api/generate_story (legacy support)
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
        const el2 = qs('[data-id="story"]');
        if (el2) el2.textContent = storyText2;
      } else {
        const txt = await res2.text();
        const el2 = qs('[data-id="story"]');
        if (el2) el2.textContent = txt;
      }
    } catch (err) {
      setError('Fel: ' + String(err));
    } finally {
      showSpinner(false);
    }
  }

  // Expose for inline binder
  window.createStory = createStory;

  // Bind UI on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    const b = qs('[data-id="btn-create"]');
    if (b) b.addEventListener('click', (e)=>{ e.preventDefault(); createStory(); });

    const useT = qs('#use-transcript');
    const transcript = qs('#transcript');
    const prompt = qs('#prompt');
    if (useT && transcript && prompt) {
      useT.addEventListener('click', ()=>{ prompt.value = transcript.value || prompt.value; });
    }
  });

})();
