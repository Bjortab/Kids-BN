(() => {
  const $ = (id) => document.getElementById(id);
  const el = {
    childName: $("childName"),
    ageRange: $("ageRange"),
    prompt: $("prompt"),
    chkWhisperExact: $("chkWhisperExact"),
    chkMakeImages: $("chkMakeImages"),
    heroName: $("heroName"),
    btnSaveHero: $("btnSaveHero"),
    btnResetHeroes: $("btnResetHeroes"),
    btnTalk: $("btnTalk"),
    btnGenerate: $("btnGenerate"),
    banner: $("banner"),
    error: $("error"),
    story: $("story"),
    audio: $("audio"),
  };

  // UI helpers
  const show = (n) => n.classList.remove("hidden");
  const hide = (n) => n.classList.add("hidden");
  const setBanner = (msg) => { el.banner.textContent = msg; show(el.banner); };
  const clearBanner = () => hide(el.banner);
  const setError = (msg) => { el.error.textContent = msg; show(el.error); };
  const clearError = () => { el.error.textContent = ""; hide(el.error); };

  // Age → längd- och stil-hints (enkelt schema, kan justeras sen)
  const ageHints = {
    "1–2 år": { targetWords: [50, 200], style: "rim, ljud, upprepningar, starka färger" },
    "3–4 år": { targetWords: [150, 350], style: "enkel handling, tydlig början och slut, humor, igenkänning" },
    "5–6 år": { targetWords: [300, 600], style: "lite mer komplex, problem som löses, fantasiinslag" },
    "7–8 år": { targetWords: [600, 900], style: "äventyr, mysterier, humor, cliffhangers" },
    "9–10 år": { targetWords: [900, 1300], style: "fantasy, vänskap, moraliska frågor, kapitel-känsla" },
    "11–12 år": { targetWords: [1200, 1800], style: "djupare teman, karaktärsutveckling" }
  };

  // Mic recording → /api/whisper_transcribe
  let mediaRecorder, chunks = [];
  async function startStopRecord() {
    try {
      if (!mediaRecorder || mediaRecorder.state === "inactive") {
        clearError();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        chunks = [];
        mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
        mediaRecorder.onstop = async () => {
          const blob = new Blob(chunks, { type: "audio/webm" });
          await sendToWhisper(blob);
        };
        mediaRecorder.start();
        el.btnTalk.textContent = "⏹️ Stoppa inspelning";
      } else {
        mediaRecorder.stop();
        el.btnTalk.textContent = "🎤 Tala in";
      }
    } catch (err) {
      setError("Mikrofonfel: " + (err?.message || err));
    }
  }

  async function sendToWhisper(blob) {
    setBanner("🎙️ Tolkar tal…");
    try {
      const fd = new FormData();
      fd.append("audio", blob, "speech.webm");
      fd.append("exact", el.chkWhisperExact.checked ? "1" : "0");

      const res = await fetch("/api/whisper_transcribe", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Whisper svarade inte: " + res.status);
      const data = await res.json();
      const text = data?.text || "";
      if (text) el.prompt.value = text;
      clearBanner();
    } catch (e) {
      clearBanner();
      setError("Kunde inte transkribera: " + (e?.message || e));
    }
  }

  // Generate story (+ TTS)
  async function generate() {
    clearError();
    el.story.textContent = "";
    hide(el.audio);

    const name = (el.childName.value || "").trim();
    const age = el.ageRange.value;
    const idea = (el.prompt.value || "").trim();
    const hero = (el.heroName.value || "").trim();
    if (!idea) { setError("Skriv eller tala in vad sagan ska handla om."); return; }

    const hint = ageHints[age] || ageHints["3–4 år"];
    setBanner("✨ Skapar saga…");

    try {
      const res = await fetch("/api/generate_story", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          childName: name || null,
          ageRange: age,
          heroName: hero || null,
          idea,
          targetWords: hint.targetWords,
          styleHint: hint.style,
          makeImages: el.chkMakeImages.checked === true  // kan ignoreras server-side
        })
      });
      if (!res.ok) throw new Error("generate_story: " + res.status);
      const data = await res.json();
      const story = data?.story || "";
      el.story.textContent = story || "(Tomt svar)";

      // Gör TTS direkt
      setBanner("🔊 Skapar uppläsning…");
      const tts = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: story,
          voice_id: (data?.voice_id || null) // backend kan sätta default annars
        })
      });
      if (!tts.ok) throw new Error("tts: " + tts.status);
      const ab = await tts.arrayBuffer();
      const url = URL.createObjectURL(new Blob([ab], { type: "audio/mpeg" }));
      el.audio.src = url; show(el.audio);

      clearBanner();
    } catch (e) {
      clearBanner();
      setError("Misslyckades: " + (e?.message || e));
    }
  }

  // Save/reset hero (endpoints valfria – om du inte vill spara lokalt/DB kan du ta bort)
  async function saveHero() {
    const h = (el.heroName.value || "").trim();
    if (!h) { setError("Skriv ett hjältenamn först."); return; }
    try {
      localStorage.setItem("bn_hero", h);
      setBanner("⭐ Hjälte sparad: " + h); setTimeout(clearBanner, 1200);
    } catch { /* no-op */ }
  }
  async function resetHeroes() {
    try {
      localStorage.removeItem("bn_hero");
      await fetch("/api/heroes_reset", { method: "POST" }).catch(()=>{});
      setBanner("🗑️ Hjältar rensade"); setTimeout(clearBanner, 1200);
    } catch { /* no-op */ }
  }
  // Förifyll från localStorage om den finns
  const saved = localStorage.getItem("bn_hero");
  if (saved) el.heroName.value = saved;

  // Bind
  el.btnTalk.addEventListener("click", startStopRecord);
  el.btnGenerate.addEventListener("click", generate);
  el.btnSaveHero.addEventListener("click", saveHero);
  el.btnResetHeroes.addEventListener("click", resetHeroes);
})();
