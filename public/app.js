async function createStory() {
  const age = document.querySelector("#age").value;
  const hero = document.querySelector("#hero").value;
  const prompt = document.querySelector("#prompt").value;

  document.querySelector("#story").textContent = "Skapar berättelse...";
  const res = await fetch(`/api/generate_story?age=${encodeURIComponent(age)}&hero=${encodeURIComponent(hero)}&prompt=${encodeURIComponent(prompt)}`);
  const data = await res.json();
  document.querySelector("#story").textContent = data.story || "Kunde inte skapa berättelse.";
}

async function playTTS() {
  const text = document.querySelector("#story").textContent;
  const voice = document.querySelector("#voice").value;

  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice }),
  });

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const audio = document.querySelector("#audio");
  audio.src = url;
  audio.play();
}
