// public/app_playTTS.js
// BN-Kids — spelar upp saga via Google TTS-backend (/api/get_audio)
// GC TTS v1.0

(function () {
  "use strict";

  const log = (...args) => console.log("[BN TTS]", ...args);
  const errLog = (...args) => console.error("[BN TTS]", ...args);

  // -----------------------------
  // Hjälpare
  // -----------------------------
  function $(sel) {
    try {
      return document.querySelector(sel);
    } catch {
      return null;
    }
  }

  function findStoryElement() {
    return (
      $('[data-id="story"]') ||
      $("#story-output") ||
      $("#story") ||
      document.querySelector("pre")
    );
  }

  function findAudioElement() {
    return (
      $('[data-id="audio"]') ||
      $("#tts-audio") ||
      document.querySelector("audio")
    );
  }

  function findTTSButton() {
    // 1) Försök på data-id (om vi har satt det i HTML)
    let btn =
      $('[data-id="btn-tts"]') ||
      $('[data-id="btn-play-tts"]') ||
      $('[data-id="btn-tts-play"]');

    if (btn) return btn;

    // 2) Fallback: hitta första knapp som innehåller texten "Läs upp"
    const buttons = Array.from(document.querySelectorAll("button"));
    btn = buttons.find((b) =>
      (b.textContent || "").toLowerCase().includes("läs upp")
    );
    return btn || null;
  }

  function setButtonState(btn, isLoading) {
    if (!btn) return;
    if (isLoading) {
      btn.dataset._originalText = btn.dataset._originalText || btn.textContent;
      btn.disabled = true;
      btn.textContent = "Skapar uppläsning …";
    } else {
      if (btn.dataset._originalText) {
        btn.textContent = btn.dataset._originalText;
      }
      btn.disabled = false;
    }
  }

  // -----------------------------
  // Huvudlogik: skapa & spela upp
  // -----------------------------
  async function handlePlayClick(ev) {
    ev.preventDefault();

    const storyEl = findStoryElement();
    const audioEl = findAudioElement();
    const btn = ev.currentTarget;

    if (!storyEl) {
      alert("Kunde inte hitta sagan i gränssnittet.");
      return;
    }
    if (!audioEl) {
      alert("Kunde inte hitta ljudspelaren på sidan.");
      return;
    }

    const text = (storyEl.textContent || "").trim();
    if (!text) {
      alert("Det finns ingen saga att läsa upp ännu.");
      return;
    }

    setButtonState(btn, true);
    log("Begär TTS för saga, längd:", text.length);

    try {
      const res = await fetch("/api/get_audio", {
        method: "POST",
        headers: { "Content-Type": "application/json;charset=utf-8" },
        body: JSON.stringify({
          text,
          // Röst kan styras senare, placeholder nu:
          voice: "sv-SE-Neural2-A"
        })
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        errLog("TTS-svar inte OK:", res.status, t);
        alert("Det gick inte att skapa uppläsning just nu (TTS-fel).");
        return;
      }

      // Vi får tillbaka binär MP3 → blob → object URL
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      audioEl.src = url;
      audioEl.load();

      // Försök spela upp direkt
      try {
        await audioEl.play();
      } catch (playErr) {
        log("Autoplay misslyckades, användaren får trycka play själv:", playErr);
      }
    } catch (e) {
      errLog("Nätverksfel mot /api/get_audio:", e);
      alert("Det gick inte att kontakta uppläsningsservern.");
    } finally {
      setButtonState(btn, false);
    }
  }

  // -----------------------------
  // Init
  // -----------------------------
  window.addEventListener("DOMContentLoaded", () => {
    const btn = findTTSButton();
    const audioEl = findAudioElement();

    if (!btn) {
      log("Hittar ingen TTS-knapp (Läs upp).");
      return;
    }
    if (!audioEl) {
      log("Hittar ingen <audio>-tagg för uppläsning.");
      return;
    }

    btn.addEventListener("click", handlePlayClick);
    log("TTS-knapp bunden till /api/get_audio");
  });
})();
