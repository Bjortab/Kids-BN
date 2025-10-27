// BN Kids — app.js (robust GC v1.4)

(function () {
  // ---- Hjälpare
  const qs = (...sels) => {
    for (const s of sels) {
      const el = typeof s === "string" ? document.querySelector(s) : s;
      if (el) return el;
    }
    return null;
  };

  const qsa = (selector) => Array.from(document.querySelectorAll(selector));

  const findButtonByText = (...needles) => {
    const btns = qsa('button, input[type="button"], input[type="submit"]');
    const nrm = (t) => (t || "").toLowerCase().trim();
    return btns.find((b) => needles.some((n) => nrm(b.value || b.innerText).includes(n)));
  };

  // ---- Element (flera möjliga ID/namn för att tåla variationer)
  const ageEl   = qs('#age', '#ageRange', 'select[name="age"]');
  const heroEl  = qs('#hero', '#heroName', 'input[name="hero"]');
  const promptEl= qs('#prompt', '#idea', '#sagoforslag', 'textarea[name="prompt"]');
  const storyEl = qs('#story', '#storyText', '.story-output', '#resultText');
  const voiceEl = qs('#voice', '#voiceSelect', 'select[name="voice"]');

  // Knappar: ID/data-attribut ELLER text-matchning (“skapa”, ”läs upp”)
  const createBtn = qs(
    '#createBtn',
    'button[data-action="create"]',
    '#btnCreate',
    findButtonByText('skapa saga', 'skapa & läs upp', 'skapa')
  );
  const playBtn = qs(
    '#playBtn',
    'button[data-action="play"]',
    '#btnPlay',
    findButtonByText('läs upp', 'spela', 'testa röst')
  );

  // Debug-hjälp
  const need = { ageEl, heroEl, promptEl, storyEl, createBtn };
  Object.entries(need).forEach(([k, v]) => {
    if (!v) console.warn(`[BN] Saknar element: ${k}`);
  });

  // ---- API-anrop
  async function createStory() {
    const age   = ageEl?.value?.trim?.() || '3-4 år';
    const hero  = heroEl?.value?.trim?.() || '';
    const prompt= promptEl?.value?.trim?.() || '';

    if (storyEl) storyEl.textContent = "Skapar berättelse...";

    try {
      const res = await fetch("/api/generate_story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ageRange: age, heroName: hero, prompt })
      });

      if (!res.ok) {
        const txt = await res.text();
        console.error("[BN] /api/generate_story fel:", res.status, txt);
        if (storyEl) storyEl.textContent = "Kunde inte skapa berättelse.";
        return;
      }

      const data = await res.json();
      if (data?.story && storyEl) {
        storyEl.textContent = data.story;
      } else if (storyEl) {
        storyEl.textContent = "Kunde inte skapa berättelse.";
      }
    } catch (err) {
      console.error("[BN] createStory exception:", err);
      if (storyEl) storyEl.textContent = "Något gick fel vid skapandet.";
    }
  }

  async function playTTS() {
    const text = storyEl?.textContent?.trim?.();
    if (!text) return;
    const voice = voiceEl?.value || "sv-SE-Wavenet-A";

    try {
      const res = await fetch("/api/tts_vertex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice })
      });

      if (!res.ok) {
        const txt = await res.text();
        console.error("[BN] /api/tts_vertex fel:", res.status, txt);
        return;
      }

      const blob = await res.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      audio.play();
    } catch (err) {
      console.error("[BN] playTTS exception:", err);
    }
  }

  // ---- Eventkoppling (tål att HTML:en är lite olika)
  if (createBtn) createBtn.addEventListener("click", (e) => { e.preventDefault?.(); createStory(); });
  if (playBtn)   playBtn.addEventListener("click",   (e) => { e.preventDefault?.(); playTTS(); });

  // Stöd för inline onclick i HTML
  window.createStory = createStory;
  window.playTTS = playTTS;

  // Fångar ev. form-submit
  const form = qs("form");
  if (form && !form.dataset.bnHandled) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      createStory();
    });
    form.dataset.bnHandled = "1";
  }

  console.log("[BN] app.js GC v1.4 laddad");
})();
