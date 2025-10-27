// BN Kids — app.js (GC v1.5, robust bind + v1/v2 endpoint-fallback)
(function () {
  const qs = (s) => document.querySelector(s);
  const qsa = (s) => Array.from(document.querySelectorAll(s));
  const log = (...a) => console.log("[BN]", ...a);
  const warn = (...a) => console.warn("[BN]", ...a);
  const lower = (t="") => t.toLowerCase().trim();

  // Hitta knappar via text så vi slipper hårda ID-krav
  function findButtonByText(...needles) {
    const btns = qsa('button, input[type="button"], input[type="submit"]');
    return btns.find(b => needles.some(n => lower(b.value||b.innerText).includes(lower(n))));
  }

  const ageEl    = qs('#age, #ageRange, select[name="age"]') || null;
  const heroEl   = qs('#hero, #heroName, input[name="hero"]') || null;
  const promptEl = qs('#prompt, #idea, #sagoforslag, textarea[name="prompt"]') || null;
  const storyEl  = qs('#story, #storyText, .story-output, #resultText') || null;
  const voiceEl  = qs('#voice, #voiceSelect, select[name="voice"]') || null;

  const createBtn = findButtonByText('skapa saga', 'skapa & läs upp', 'skapa');
  const playBtn   = findButtonByText('läs upp', 'spela', 'testa röst');

  if (!createBtn) warn("Hittar ingen 'Skapa saga'-knapp via text.");
  if (!playBtn)   warn("Hittar ingen 'Läs upp'-knapp via text.");

  async function createStory() {
    const age    = (ageEl?.value || '3-4 år').trim();
    const hero   = (heroEl?.value || '').trim();
    const prompt = (promptEl?.value || '').trim();

    if (storyEl) storyEl.textContent = "Skapar berättelse...";

    // Försök v2 först (POST JSON)
    try {
      let res = await fetch("/api/generate_story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ageRange: age, heroName: hero, prompt })
      });
      if (!res.ok) throw new Error("v2 misslyckades " + res.status);

      const data = await res.json();
      if (data?.story) {
        storyEl && (storyEl.textContent = data.story);
        return;
      }
      throw new Error("v2 gav inget story-fält");
    } catch (e1) {
      // Fall-back till v1 (GET med query)
      try {
        const url = `/api/generate?ageRange=${encodeURIComponent(age)}&hero=${encodeURIComponent(hero)}&prompt=${encodeURIComponent(prompt)}`;
        let res = await fetch(url);
        if (!res.ok) throw new Error("v1 misslyckades " + res.status);
        const data = await res.json();
        storyEl && (storyEl.textContent = data.story || "Kunde inte skapa berättelse.");
      } catch (e2) {
        console.error("[BN] createStory fel:", e1, e2);
        storyEl && (storyEl.textContent = "Kunde inte skapa berättelse.");
      }
    }
  }

  async function playTTS() {
    const text = (storyEl?.textContent || "").trim();
    if (!text) return;
    const voice = (voiceEl?.value || "sv-SE-Wavenet-A");

    // Försök Vertex först
    try {
      let res = await fetch("/api/tts_vertex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice })
      });
      if (!res.ok) throw new Error("tts_vertex " + res.status);
      const blob = await res.blob();
      new Audio(URL.createObjectURL(blob)).play();
      return;
    } catch (e1) {
      // Fall-back till befintlig /api/tts
      try {
        let res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice })
        });
        if (!res.ok) throw new Error("tts " + res.status);
        const blob = await res.blob();
        new Audio(URL.createObjectURL(blob)).play();
      } catch (e2) {
        console.error("[BN] playTTS fel:", e1, e2);
      }
    }
  }

  // Knyt event
  createBtn && createBtn.addEventListener("click", (e) => { e.preventDefault?.(); createStory(); });
  playBtn   && playBtn.addEventListener("click",   (e) => { e.preventDefault?.(); playTTS();   });

  // Exponera för inline onclick om HTML redan har det
  window.createStory = createStory;
  window.playTTS = playTTS;

  log("app.js GC v1.5 laddad");
})();
