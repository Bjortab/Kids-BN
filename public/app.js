// BN Kids – app.js (spinnern låses aldrig, robust felhantering)

(() => {
  const $ = (s) => document.querySelector(s);

  const $age     = $('#age');
  const $prompt  = $('#prompt');
  const $hero    = $('#hero');

  const $btnStory= $('#btn-story');
  const $btnTTS  = $('#btn-tts');

  const $spinner = $('#spinner');
  const $status  = $('#status');
  const $result  = $('#result');
  const $audio   = $('#audio');

  // ---------- UI helpers ----------
  function setBusy(on, msg="") {
    if ($spinner) $spinner.style.display = on ? 'inline-flex' : 'none';
    if ($btnStory) $btnStory.disabled = on;
    if ($btnTTS)   $btnTTS.disabled   = on;
    if ($status)   $status.textContent = msg || (on ? 'Arbetar…' : '');
  }

  function showError(msg) {
    console.error(msg);
    if ($status) $status.textContent = `Fel: ${msg}`;
    setBusy(false);
  }

  // Dölj spinner direkt vid start (om css skulle vara fel)
  setBusy(false, '');

  // Globala “watchdogs” så UI aldrig fastnar
  window.addEventListener('error', () => setBusy(false));
  window.addEventListener('unhandledrejection', () => setBusy(false));
  setTimeout(() => setBusy(false), 6000);

  // ---------- Längdkontroller ----------
  function ageToControls(age) {
    switch (age) {
      case '1-2':  return { minChars: 60,  maxChars: 90,  minWords: 8,   maxWords: 20,  chapters:1, styleHint:'pekbok; ljudord; enkla tvåordsmeningar' };
      case '3-4':  return { minWords: 80,  maxWords: 160, chapters:1, styleHint:'korta meningar; humor; tydlig början–slut' };
      case '5-6':  return { minWords: 180, maxWords: 320, chapters:1, styleHint:'problem–lösning; naturligt slut' };
      case '7-8':  return { minWords: 350, maxWords: 600, chapters:1, styleHint:'äventyr/mysterium; varierade scener' };
      case '9-10': return { minWords: 500, maxWords: 900, chapters:2, styleHint:'två kapitel; mer komplex handling' };
      case '11-12':return { minWords: 900, maxWords: 1600,chapters:3, styleHint:'risk/uppoffring; naturligt slut' };
      default:     return { minWords: 250, maxWords: 500, chapters:1 };
    }
  }

  // ---------- API: Story ----------
  async function createStory() {
    try {
      setBusy(true, 'Skapar saga…');

      const age = ($age?.value || '5-6');
      const controls = ageToControls(age);

      const res = await fetch('/api/generate_story', {
        method: 'POST',
        headers: { 'content-type':'application/json' },
        body: JSON.stringify({
          age,
          prompt: $prompt?.value || '',
          heroName: $hero?.value || '',
          controls
        })
      });

      if (!res.ok) {
        const t = await res.text().catch(()=> '');
        throw new Error(`Story ${res.status} ${t}`);
      }
      const data = await res.json();
      const story = (data?.story || '').trim();
      if (!story) throw new Error('Tom saga från API.');
      if ($result) $result.textContent = story;
      setBusy(false, 'Klar');
    } catch (e) {
      showError(e.message || e);
    } finally {
      setBusy(false);
    }
  }

  // ---------- API: TTS ----------
  async function createTTS() {
    try {
      const text = ($result?.textContent || '').trim();
      if (!text) { showError('Ingen text att läsa. Skapa saga först.'); return; }

      setBusy(true, 'Skapar uppläsning…');

      const res = await fetch('/tts', {
        method: 'POST',
        headers: { 'content-type':'application/json' },
        body: JSON.stringify({ text })
      });

      if (!res.ok) {
        // Försök läsa json-fel
        let msg = '';
        try { msg = (await res.json())?.error || ''; } catch {}
        if (!msg) { try { msg = await res.text(); } catch {} }
        throw new Error(msg || `TTS ${res.status}`);
      }

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      if ($audio) {
        $audio.src = url;
        $audio.play().catch(()=>{});
      }
      setBusy(false, 'Klar');
    } catch (e) {
      showError(e.message || e);
    } finally {
      setBusy(false);
    }
  }

  // ---------- Events ----------
  $btnStory?.addEventListener('click', (ev) => { ev.preventDefault(); createStory(); });
  $btnTTS?.addEventListener('click',   (ev) => { ev.preventDefault(); createTTS();   });

})();
