// public/app.js
(() => {
  // ====== Hjälpare för DOM ======
  const $ = (sel) => document.querySelector(sel);
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);

  // ====== Fält/knappar ======
  const nameEl   = $('#childName')        || $('#barnetsNamn') || $('#name') || $('#child-name');
  const ageEl    = $('#age')              || $('#barnAge')     || $('#ageSelect');
  const promptEl = $('#prompt')           || $('#storyPrompt') || $('#sagogista') || $('#topic');
  const whisperEl= $('#useWhisper')       || $('#whisper')     || $('#whisperFlag');
  const heroEl   = $('#heroName')         || $('#hero')        || $('#hjalte');
  // Röstfält – stöd för flera id:n
  const voiceEl  = $('#voiceId') || $('#voice-id') || $('#elevenlabsVoiceId') || $('#voice');

  const btnSpeak    = $('#btn-speak')            || $('#speakBtn') || $('#talk');
  const btnGenerate = $('#btn-generate-tts')     || $('#generateWithTts') || $('#gen-tts');
  const btnSaveHero = $('#btn-save-hero')        || $('#saveHero');
  const btnClear    = $('#btn-clear-heroes')     || $('#clearHeroes');

  const resultEl = $('#result') || $('#storyResult') || $('#output');
  const statusEl = $('#status') || $('#appStatus')   || $('#msg');
  const audioEl  = $('#player') || $('#audio')       || (() => {
    const a = document.createElement('audio');
    a.controls = true;
    a.style.width = '100%';
    resultEl?.parentNode?.insertBefore(a, resultEl?.nextSibling || null);
    return a;
  })();

  // ====== UI: cache-indikator skapas om den saknas ======
  let cacheBox = $('#cacheInfo');
  if (!cacheBox) {
    cacheBox = document.createElement('div');
    cacheBox.id = 'cacheInfo';
    cacheBox.style.cssText = 'margin:.25rem 0 .75rem 0;font-size:.85rem;opacity:.85;';
    audioEl?.parentNode?.insertBefore(cacheBox, audioEl);
  }
  const setCacheInfo = (hits, total, voiceId) => {
    if (!cacheBox) return;
    const pct = (!total || total <= 0) ? 0 : Math.round((Number(hits) / Number(total)) * 100);
    cacheBox.innerHTML = `🎯 <b>Cache</b>: ${hits}/${total} träffar (${pct}%) · Röst: <code>${(voiceId || '').toString().slice(0,16) || 'standard'}</code>`;
  };

  // ====== Snackbar/Status ======
  const setStatus = (t, type='') => {
    if (!statusEl) return;
    statusEl.textContent = t || '';
    statusEl.style.color = type === 'err' ? '#ff6060' : '#a0ffa0';
  };

  // Visa/avsluta “Arbetar …”
  let working = false;
  const startWork = (txt='Arbetar…') => {
    working = true;
    setStatus(txt, '');
    document.body.style.cursor = 'progress';
    btnGenerate && (btnGenerate.disabled = true);
  };
  const stopWork = () => {
    working = false;
    setStatus('');
    document.body.style.cursor = 'default';
    btnGenerate && (btnGenerate.disabled = false);
  };

  // ====== Åldersstyrning (låst enligt tidigare) ======
  function ageToControls(group) {
    switch ((group || '').trim()) {
      case '1-2 år':
        return {
          minChars: 60, maxChars: 90,    // ~75 tecken
          minWords: 8,  maxWords: 20,
          chapters: 1,
          styleHint: 'pekbok; ljudord; enkla tvåordsmeningar; tydlig början-slut; varje mening kan stå på egen sida;',
          pageBreakTag: '[BYT SIDA]'
        };
      case '3-4 år':
        return {
          minWords: 80, maxWords: 160,
          chapters: 1,
          styleHint: 'korta meningar; igenkänning; humor; tydlig början-slut; gärna 3–5 scener'
        };
      case '5-6 år':
        return {
          minWords: 180, maxWords: 320,
          chapters: 1,
          styleHint: 'problem–lösning; varm ton; enkla cliffhangers men naturligt slut'
        };
      case '7-8 år':
        return {
          minWords: 350, maxWords: 600,
          chapters: 1,
          styleHint: 'äventyr/mysterium; tydliga val; varierade scener; naturligt slut (ingen mallfras)'
        };
      case '9-10 år':
      case '11-12 år':
        return {
          minWords: 500, maxWords: 900,
          chapters: 2,
          styleHint: 'mer komplex handling; val och konsekvenser; naturlig upplösning utan klyschig slutfras'
        };
      default:
        return { minWords: 180, maxWords: 350, chapters: 1, styleHint: 'naturligt slut.' };
    }
  }

  // Trimma text före TTS (tar bort [BYT SIDA] m.m.)
  const sanitizeForTTS = (t) =>
    (t || '').replace(/\[BYT SIDA\]/g, ' ').replace(/\s{2,}/g, ' ').trim();

  // ====== Skriv ut saga ======
  const renderStory = (story) => {
    if (!resultEl) return;
    resultEl.textContent = story || '';
  };

  // ====== Hämta saga från backend ======
  async function requestStory({ lang='sv' } = {}) {
    const childName = (nameEl?.value || '').trim();
    const prompt    = (promptEl?.value || '').trim();
    const ageGroup  = (ageEl?.value || '').trim();
    const heroName  = (heroEl?.value || '').trim();
    const useExtra  = !!(whisperEl && whisperEl.checked);

    const controls = ageToControls(ageGroup);

    const payload = {
      lang,
      childName,
      heroName,
      prompt,
      ageRange: ageGroup,
      controls,
      read_aloud: true
    };

    const res = await fetch('/story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      const msg = data?.error || res.statusText || 'Kunde inte skapa sagan.';
      throw new Error(msg);
    }
    return data; // { ok:true, story, meta }
  }

  // ====== TTS-anrop ======
  async function requestTTS(text) {
    const voiceId = (voiceEl?.value || '').trim(); // tomt = serverns standard
    const res = await fetch('/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sanitizeForTTS(text), voiceId })
    });

    // Plocka cache-huvuden även vid fel
    const hits  = res.headers.get('x-tts-hits')  || '0';
    const total = res.headers.get('x-tts-total') || '0';
    const vId   = res.headers.get('x-tts-voice-id') || voiceId || '';
    setCacheInfo(hits, total, vId);

    if (!res.ok) {
      const errText = await res.text().catch(()=>'');
      throw new Error(errText || `TTS fel: ${res.status}`);
    }

    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }

  // ====== Huvudflöde: Skapa saga + uppläsning ======
  async function generateWithTts() {
    if (working) return;
    try {
      startWork('Skapar saga …');

      // 1) Skapa saga
      const storyRes = await requestStory({ lang: 'sv' });
      renderStory(storyRes.story || '');
      setStatus('Genererar uppläsning …');

      // 2) TTS
      const url = await requestTTS(storyRes.story || '');
      audioEl.src = url;
      audioEl.play().catch(()=>{ /* vissa browsers blockar autoplay */ });

      setStatus('Klart!');
    } catch (e) {
      setStatus(e?.message || 'Ett fel inträffade.', 'err');
    } finally {
      stopWork();
    }
  }

  // ====== “Tala in” (UI-krok – backend redan klar hos dig) ======
  async function startWhisper() {
    // Din befintliga /whisper_transcribe implementering används;
    // den här knappen skickar bara användaren dit om du redan har det flödet.
    try {
      setStatus('Lyssnar …');
      const res = await fetch('/whisper_transcribe', { method: 'POST' });
      const data = await res.json().catch(()=> ({}));
      if (data?.ok && data?.text) {
        promptEl && (promptEl.value = data.text);
        setStatus('Upptäckt tal — klart!');
      } else {
        throw new Error(data?.error || 'Ingen text fångades.');
      }
    } catch (e) {
      setStatus(e?.message || 'Taligenkänning misslyckades.', 'err');
    }
  }

  // ====== Hjältar (lämnas oförändrat, enkel localStorage) ======
  function loadHeroes() {
    try {
      const list = JSON.parse(localStorage.getItem('bn_heroes') || '[]');
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  }
  function saveHeroes(list) {
    try { localStorage.setItem('bn_heroes', JSON.stringify(list)); } catch {}
  }

  on(btnSaveHero, 'click', () => {
    const name = (heroEl?.value || '').trim();
    if (!name) return;
    const list = loadHeroes();
    if (!list.includes(name)) list.push(name);
    saveHeroes(list);
    setStatus(`Hjälte sparad: ${name}`);
  });

  on(btnClear, 'click', () => {
    saveHeroes([]);
    heroEl && (heroEl.value = '');
    setStatus('Hjältar rensade.');
  });

  // ====== Eventkopplingar ======
  on(btnGenerate, 'click', (e) => {
    e.preventDefault();
    generateWithTts();
  });

  on(btnSpeak, 'click', (e) => {
    e.preventDefault();
    startWhisper();
  });

  // ====== Start: städa UI (ingen spinner vid sidladdning) ======
  window.addEventListener('DOMContentLoaded', () => {
    stopWork();
    setStatus('');
    setCacheInfo(0, 0, '');
  });
})();
