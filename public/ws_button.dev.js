// ==========================================================
// BN-KIDS WS DEV — ws_button.dev.js (v3)
// Extra knapp "Skapa saga (WS dev)"
//  - använder worldstate.dev.js
//  - skickar recap + önskemål till /api/generate_story
// ==========================================================

(function () {
  "use strict";

  function log() {
    try {
      console.log("[WS DEV]", ...arguments);
    } catch (_) {
      // ignore
    }
  }

  function setError(text) {
    const el = document.querySelector("[data-id='error']");
    if (!el) return;
    el.style.display = text ? "block" : "none";
    el.textContent = text || "";
  }

  function getStoryElement() {
    return (
      document.querySelector("[data-id='story']") ||
      document.getElementById("story-output") ||
      null
    );
  }

  // uppdatera meta (ålder, hjälte, längd) från formuläret, om ändrat
  function syncMetaFromForm(state) {
    if (!state || !state.meta) return state;

    const ageSel = document.getElementById("age");
    if (ageSel) {
      state.meta.ageValue = ageSel.value || state.meta.ageValue || "";
      if (ageSel.selectedOptions && ageSel.selectedOptions[0]) {
        state.meta.ageLabel =
          ageSel.selectedOptions[0].textContent.trim() ||
          state.meta.ageLabel ||
          "";
      }
    }

    const heroInput = document.getElementById("hero");
    if (heroInput && heroInput.value.trim()) {
      state.meta.hero = heroInput.value.trim();
    }

    const lengthSel = document.getElementById("length");
    if (lengthSel) {
      state.meta.lengthValue =
        lengthSel.value || state.meta.lengthValue || "";
      if (lengthSel.selectedOptions && lengthSel.selectedOptions[0]) {
        state.meta.lengthLabel =
          lengthSel.selectedOptions[0].textContent.trim() ||
          state.meta.lengthLabel ||
          "";
      }
    }

    return state;
  }

  async function handleWsClick(ev) {
    ev.preventDefault();
    setError("");

    if (!window.WS_DEV) {
      setError("WS-dev är inte laddat.");
      return;
    }

    const btn = ev.currentTarget;
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Skapar kapitel (WS dev)…";

    const storyEl = getStoryElement();
    const promptEl = document.querySelector("[data-id='prompt']");
    const wishText =
      (promptEl && promptEl.value && promptEl.value.trim()) || "";

    try {
      // 1. Ladda befintlig bok eller skapa ny från formuläret
      let state = window.WS_DEV.load();
      if (!state) {
        log("ingen bok i storage → skapar ny från formulär");
        state = window.WS_DEV.createWorldFromForm();
      } else {
        log("hittade befintlig bok i storage");
      }

      // uppdatera meta om användaren ändrat ålder/hjälte/längd mitt i boken
      state = syncMetaFromForm(state);

      // om vi har en ny önskan och ingen last_prompt än → spara som bas
      if (wishText && !state.last_prompt) {
        state.last_prompt = wishText;
      }

      // 2. Bygg LLM-prompt för nästa kapitel
      const llmPrompt = window.WS_DEV.buildWsPrompt(state, wishText);

      const ageValue =
        (state.meta && state.meta.ageValue) || "7-8";
      const lengthValue =
        (state.meta && state.meta.lengthValue) || "medium";
      const hero =
        (state.meta && state.meta.hero && state.meta.hero.trim()) ||
        "hjälten";

      const body = {
        age: ageValue,
        length: lengthValue,
        hero: hero,
        prompt: llmPrompt
      };

      // 3. Anropa /api/generate_story (samma endpoint som vanliga knappen)
      const res = await fetch("/api/generate_story", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(body)
      });

      let data;
      try {
        data = await res.json();
      } catch (e) {
        const t = await res.text().catch(() => "");
        console.warn("[WS DEV] kunde inte läsa JSON:", res.status, t);
        setError("Servern skickade inte giltig JSON.");
        return;
      }

      if (!data || !data.story) {
        console.warn("[WS DEV] saknar story-fält i svar:", data);
        setError("Kunde inte skapa kapitel (saknar story-fält).");
        return;
      }

      const text = String(data.story || "").trim();
      if (storyEl) {
        storyEl.textContent = text;
      }

      // 4. Lägg till kapitlet i world state och spara
      state = window.WS_DEV.addChapterToWS(state, text);
      window.WS_DEV.save(state);

      const count = (state.chapters || []).length;
      log("chapters now:", Array.from({ length: count }, (_, i) => i + 1));
    } catch (e) {
      console.error("[WS DEV] fel i WS-knapp:", e);
      setError("Något gick fel i WS dev: " + (e.message || e));
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  // Binda knappen när sidan laddats
  document.addEventListener("DOMContentLoaded", function () {
    const btn = document.querySelector("[data-id='btn-ws-dev']");
    if (!btn) {
      log("hittar inte WS dev-knapp i DOM:en");
      return;
    }
    if (!window.WS_DEV) {
      log("WS_DEV saknas – kan inte binda WS-knapp ännu");
      return;
    }
    btn.addEventListener("click", handleWsClick);
    log("WS-knapp bunden");
  });
})();
