// BN Kids — app.js (GC v1.3, stabil mot generate_story.js GC v1.1)

async function createStory() {
  const age = document.querySelector("#age").value.trim();
  const hero = document.querySelector("#hero").value.trim();
  const prompt = document.querySelector("#prompt").value.trim();

  document.querySelector("#story").textContent = "Skapar berättelse...";

  try {
    const res = await fetch("/api/generate_story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ageRange: age, heroName: hero, prompt })
    });

    const data = await res.json();
    if (data?.story) {
      document.querySelector("#story").textContent = data.story;
    } else {
      document.querySelector("#story").textContent = "Kunde inte skapa berättelse.";
    }
  } catch (err) {
    console.error("Fel i createStory:", err);
    document.querySelector("#story").textContent = "Något gick fel vid skapande av berättelsen.";
  }
}

async function playTTS() {
  const text = document.querySelector("#story").textContent.trim();
  if (!text) return;
  const voice = document.querySelector("#voice").value || "sv-SE-Wavenet-A";

  try {
    const res = await fetch("/api/tts_vertex", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice })
    });

    const blob = await res.blob();
    const audio = new Audio(URL.createObjectURL(blob));
    audio.play();
  } catch (err) {
    console.error("Fel i playTTS:", err);
  }
}

// Event-lyssnare (behåll knapparna stabila)
document.querySelector("#createBtn")?.addEventListener("click", createStory);
document.querySelector("#playBtn")?.addEventListener("click", playTTS);
