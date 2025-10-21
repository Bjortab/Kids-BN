// BN Kids app.js — Golden Copy v1.6.0
// Låsta längder, stabil spinner, fungerande TTS-knapp

(() => {

  const $age     = document.querySelector("#age");
  const $prompt  = document.querySelector("#prompt");
  const $hero    = document.querySelector("#hero");
  const $btnStory= document.querySelector("#btn-story");
  const $btnTTS  = document.querySelector("#btn-tts");
  const $result  = document.querySelector("#result");
  const $audio   = document.querySelector("#audio");
  const $spinner = document.querySelector("#spinner");

  const busy = (state) => {
    if ($spinner) $spinner.style.visibility = state ? "visible" : "hidden";
    if ($btnStory) $btnStory.disabled = state;
    if ($btnTTS) $btnTTS.disabled = state;
  };

  const showError = (msg) => {
    console.error(msg);
    alert(msg);
  };

  busy(false);

  function ageToControls(age) {
    switch (age) {
      case "1-2":
        return {
          minChars: 60,
          maxChars: 90,
          minWords: 8,
          maxWords: 20,
          chapters: 1,
          styleHint: "pekbok; ljudord; enkla tvåordsmeningar"
        };
      case "3-4":
        return {
          minWords: 80,
          maxWords: 160,
          chapters: 1,
          styleHint: "korta meningar; humor; tydlig början-slut"
        };
      default:
        return { minWords: 120, maxWords: 240, chapters: 1 };
    }
  }

  async function createStory() {
    try {
      busy(true);
      const age = $age.value || "3-4";
      const controls = ageToControls(age);

      const res = await fetch("/story", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          age,
          prompt: $prompt.value,
          heroName: $hero.value,
          controls
        })
      });

      if (!res.ok) throw new Error("Story API error");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Story error");

      $result.textContent = data.story;
    } catch (err) {
      showError(err.message);
    } finally {
      busy(false);
    }
  }

  async function createTTS() {
    try {
      busy(true);
      const text = $result.textContent.trim();
      if (!text) throw new Error("Ingen text att läsa upp.");

      const res = await fetch("/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text })
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      $audio.src = url;
      $audio.play();
    } catch (err) {
      showError(err.message);
    } finally {
      busy(false);
    }
  }

  $btnStory?.addEventListener("click", createStory);
  $btnTTS?.addEventListener("click", createTTS);

})();
