const el = {
  recordBtn: document.getElementById("recordBtn"),
  generateBtn: document.getElementById("generateBtn"),
  resetBtn: document.getElementById("resetHeroes"),
  prompt: document.getElementById("prompt"),
  name: document.getElementById("childName"),
  age: document.getElementById("ageGroup"),
  out: document.getElementById("storyOutput"),
  audio: document.getElementById("storyAudio"),
  audioWrap: document.getElementById("audioWrap"),
  playFallback: document.getElementById("playFallback"),
  recStatus: document.getElementById("recStatus"),
};

let isRecording = false;
let mediaRecorder;
let chunks = [];

// ====== RÖSTINPELNING (WHISPER) ======
el.recordBtn.addEventListener("click", async () => {
  if (!isRecording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = e => chunks.push(e.data);

      mediaRecorder.onstart = () => {
        isRecording = true;
        el.recordBtn.classList.add("recording");
        el.recordBtn.setAttribute("aria-pressed", "true");
        el.recordBtn.querySelector(".btn-text").textContent = "⏹ Stoppa inspelning";
        el.recStatus.textContent = "Spelar in… prata tydligt nära mikrofonen.";
      };

      mediaRecorder.onstop = async () => {
        isRecording = false;
        el.recordBtn.classList.remove("recording");
        el.recordBtn.setAttribute("aria-pressed", "false");
        el.recordBtn.querySelector(".btn-text").textContent = "🎤 Tala in";
        el.recStatus.textContent = "Bearbetar din inspelning…";

        const blob = new Blob(chunks, { type: "audio/webm" });
        const formData = new FormData();
        formData.append("file", blob, "voice.webm");

        try {
          const res = await fetch("/functions/whisper_transcribe", { method: "POST", body: formData });
          const data = await res.json();
          el.prompt.value = (data && data.text) ? data.text : "";
          el.recStatus.textContent = data.text ? "Klar – texten fylldes i automatiskt." : "Inget kunde höras – prova igen.";
        } catch (e) {
          el.recStatus.textContent = "Något gick fel vid tolkningen. Prova igen.";
        }
      };

      mediaRecorder.start();
    } catch (err) {
      alert("Kunde inte starta mikrofonen: " + err.message);
    }
  } else {
    mediaRecorder.stop();
  }
});

// ====== SKAPA SAGA + TTS (AUTOSPEL) ======
el.generateBtn.addEventListener("click", async () => {
  const name = (el.name.value || "").trim();
  const age = el.age.value;
  const prompt = (el.prompt.value || "").trim();

  if (!prompt) return alert("Skriv eller tala in vad sagan ska handla om!");

  el.out.innerHTML = "<p><i>Skapar saga…</i></p>";
  el.audioWrap.hidden = true;
  el.audio.removeAttribute("src");
  el.playFallback.hidden = true;

  // 1) Text
  const storyRes = await fetch("/functions/generate_story", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, age, prompt })
  });
  const storyData = await storyRes.json();
  if (!storyData.story) return alert("Kunde inte skapa sagan.");

  el.out.innerHTML = `<h3>${escapeHtml(storyData.title)}</h3><p>${nl2p(storyData.story)}</p>`;
  scrollToResult();

  // 2) Ljud
  const ttsRes = await fetch("/functions/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: storyData.story })
  });
  const ttsData = await ttsRes.json();

  if (ttsData.url) {
    el.audio.src = ttsData.url;
    el.audioWrap.hidden = false;

    // Försök autoplay (tillåtet efter klick)
    try {
      await el.audio.play();
      el.playFallback.hidden = true;
    } catch (_) {
      // Om webbläsaren stoppar autoplay
      el.playFallback.hidden = false;
    }
  }
});

// Fallback-knapp om autoplay blockeras
el.playFallback.addEventListener("click", () => {
  el.audio.play();
  el.playFallback.hidden = true;
});

// ====== Rensa hjältar (nollställer minne) ======
el.resetBtn.addEventListener("click", async () => {
  try {
    await fetch("/functions/heroes_reset", { method: "POST" });
    alert("Alla hjältar är nu nollställda. Nya sagor använder inga tidigare figurer förrän du väljer att spara dem igen.");
  } catch {
    alert("Kunde inte rensa hjältar. Försök igen.");
  }
});

// ====== Hjälpfunktioner ======
function scrollToResult() {
  document.getElementById("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

function nl2p(text) {
  return escapeHtml(text).split(/\n{2,}/).map(p => `<p>${p}</p>`).join("");
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
