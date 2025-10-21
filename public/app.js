/* BN – app.js  (stabil TTS, spinner-fix, voice override) */

(() => {

  // ======= DOM refs =========================================================
  const $age     = document.querySelector('#age');
  const $prompt  = document.querySelector('#prompt');
  const $hero    = document.querySelector('#hero');
  const $voice   = document.querySelector('#voiceId');     // NYTT: inputfält för voice
  const $btnTTS  = document.querySelector('#btn-tts');
  const $btnStory= document.querySelector('#btn-story');
  const $status  = document.querySelector('#status');       // liten statusrad
  const $spinner = document.querySelector('#spinner');      // de tre prickarna
  const $result  = document.querySelector('#result');
  const $audio   = document.querySelector('#player');

  // ======= UI helpers =======================================================
  const busy = (on, msg = '') => {
    if ($btnTTS)   $btnTTS.disabled   = on;
    if ($btnStory) $btnStory.disabled = on;
    if ($spinner)  $spinner.style.visibility = on ? 'visible' : 'hidden';
    if ($status)   $status.textContent = msg || (on ? 'Arbetar…' : 'Klar!');
  };

  const showError = (msg) => {
    if ($status) $status.textContent = `Fel: ${msg}`;
    console.error(msg);
  };

  // Init: inga snurr direkt
  busy(false, 'Klar!');

  // ======= Story (oförändrat utanför UI) ===================================
  const ageToControls = (age) => {
    switch (age) {
      case '1-2': return { minChars: 60, maxChars: 90, chapters: 1, pageBreakTag: '[BYT SIDA]', styleHint: 'pekbok; ljudord; enkla tvåordsmeningar' };
      case '3-4': return { minWords: 80, maxWords: 160, chapters: 1, styleHint: 'korta meningar; igenkänning; humor; tydlig början-slut; 3–5 scener' };
      case '5-6': return { minWords: 180, maxWords: 320, chapters: 1, styleHint: 'problem–lösning; cliffhangers men naturligt slut' };
      case '7-8': return { minWords: 350, maxWords: 600, chapters: 1, styleHint: 'äventyr/mysterium; varierade scener; naturligt slut' };
      case '9-10':return { minWords: 500, maxWords: 900, chapters: 2, styleHint: 'mer komplex handling; 2 kapitel' };
      default:    return { minWords: 500, maxWords: 900, chapters: 2, styleHint: 'standard' };
    }
  };

  async function makeStory() {
    try {
      busy(true, 'Skapar saga…');
      const age = $age?.value || '5-6';
      const controls = ageToControls(age);

      const res = await fetch('/story', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          age,
          prompt: $prompt?.value || '',
          heroName: $hero?.value || '',
          controls
        })
      });

      if (!res.ok) throw new Error(`Story ${res.status}`);
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || 'Story error');
      if ($result) $result.textContent = data.story || '';
    } catch (e) {
      showError(e.message || e);
    } finally {
      busy(false);
    }
  }

  // ======= TTS ==============================================================
  async function speakText() {
    try {
      const text = ($result?.textContent || '').trim();
      if (!text) return showError('Ingen text att läsa.');

      busy(true, 'Skapar uppläsning…');

      const payload = { text };
      const v = ($voice?.value || '').trim();
      if (v) payload.voiceId = v; // överstyr env-voice

      const res = await fetch('/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });

      // Avsluta spinner även vid fel
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.json())?.error || ''; } catch {}
        throw new Error(detail || `TTS ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if ($audio) {
        $audio.src = url;
        $audio.play().catch(() => {/* ignorera autoplay block */});
      }
    } catch (e) {
      showError(e.message || e);
    } finally {
      busy(false);
    }
  }

  // ======= Events ===========================================================
  $btnStory?.addEventListener('click', (e) => {
    e.preventDefault();
    makeStory();
  });

  $btnTTS?.addEventListener('click', (e) => {
    e.preventDefault();
    speakText();
  });

})();
