// =======================================================
// BN-KIDS – Enkel TTS-klient (play current story)
// Fil: public/app_playTTS.js
// =======================================================
(function (global) {
  "use strict";

  const TTS_API_URL = "/api/get_audio";

  function getStoryText() {
    const el = document.getElementById("story-output");
    if (!el) {
      console.warn("[BN TTS] Hittar inte #story-output i DOM:en.");
      return "";
    }
    const txt = el.innerText || el.textContent || "";
    return (txt || "").trim();
  }

  async function playTTSForCurrentStory() {
    const text = getStoryText();
    if (!text) {
      alert("Det finns ingen berättelse att läsa upp ännu.");
      return;
    }

    const btn = document.querySelector('[data-id="btn-tts"]');
    const oldLabel = btn ? btn.textContent : "";

    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Skapar ljud...";
      }

      const res = await fetch(TTS_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,           // hela berättelsen
          lang: "sv",     // svenska
          voice: "child", // kan tweakas i backend sen
        }),
      });

      if (!res.ok) {
        console.error("[BN TTS] API-svar ej OK:", res.status, res.statusText);
        alert("Kunde inte skapa ljud just nu (TTS-fel). Försök igen senare.");
        return;
      }

      let data;
      try {
        data = await res.json();
      } catch (e) {
        console.error("[BN TTS] Kunde inte parsa JSON från TTS-API:", e);
        alert("Tekniskt fel vid TTS-svar.");
        return;
      }

      const audioUrl = data && (data.url || data.audioUrl || data.signedUrl);
      if (!audioUrl) {
        console.error("[BN TTS] Ingen ljud-URL i svaret:", data);
        alert("Kunde inte hitta någon ljudfil att spela upp.");
        return;
      }

      const audioEl = document.getElementById("tts-audio");
      if (!audioEl) {
        console.warn("[BN TTS] Hittar inte #tts-audio, försöker öppna i ny flik.");
        window.open(audioUrl, "_blank");
        return;
      }

      audioEl.src = audioUrl;

      try {
        await audioEl.play();
      } catch (e) {
        console.warn("[BN TTS] Autoplay misslyckades, användaren får trycka play själv.", e);
      }
    } catch (err) {
      console.error("[BN TTS] Oväntat fel:", err);
      alert("Något gick fel när ljudet skulle skapas.");
    } finally {
      if (btn) {
        btn.disabled = false;
        if (oldLabel) btn.textContent = oldLabel;
      }
    }
  }

  function initStoryTTSButton() {
    const btn = document.querySelector('[data-id="btn-tts"]');
    if (!btn) {
      console.warn("[BN TTS] Hittar inte TTS-knappen med data-id=\"btn-tts\".");
      return;
    }

    if (btn.__bnTTSBound) return;
    btn.__bnTTSBound = true;

    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      playTTSForCurrentStory();
    });

    console.log("[BN TTS] TTS-knapp bunden.");
  }

  global.BNKidsTTS = {
    playCurrentStory: playTTSForCurrentStory,
    initButton: initStoryTTSButton,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initStoryTTSButton);
  } else {
    initStoryTTSButton();
  }
})(window);
