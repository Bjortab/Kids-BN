// ==========================================================
// BN-KIDS WS DEV — ws_button.dev.js (GC v7 stabil)
// - Extra knapp "Skapa saga (WS dev)" som använder worldstate
// - Kopplad till WS_DEV.* (load, buildWsPrompt, addChapterAndSave)
// - Lägger till request-lock så bara SENASTE svaret får skriva
//   till sagarutan (fixar "två sagor"-problemet).
// ==========================================================

(function () {
  "use strict";

  const log = (...args) => console.log("[WS DEV]", ...args);

  // Request-lock: används för att ignorera gamla svar
  let latestRequestId = 0;

  // -------------------------------------------------------
  // Hjälpare
  // -------------------------------------------------------
  function $(sel) {
    try {
      return document.querySelector(sel);
    } catch (e) {
      return null;
    }
  }

  function setSpinner(active, msg) {
    const spinner = $('[data-id="spinner"]');
    const errorEl = $('[data-id="error"]');
    if (spinner) spinner.style.display = active ? "flex" : "none";
    if (errorEl) {
      if (msg) errorEl.textContent = msg;
      else if (!active) errorEl.textContent = "";
    }
  }

  // -------------------------------------------------------
  // Koppla Rensa-knappen till WS_DEV.reset()
// -------------------------------------------------------
  function hookResetButton() {
    const clearBtn = document.getElementById("clear-transcript");
    if (!clearBtn) {
      log("hittar ingen Rensa-knapp (clear-transcript)");
      return;
    }
    clearBtn.addEventListener("click", () => {
      if (!window.WS_DEV || typeof window.WS_DEV.reset !== "function") return;
      try {
        window.WS_DEV.reset();
        log("bok reset via Rensa-knappen");
      } catch (e) {
        console.warn("[WS DEV] reset via Rensa misslyckades", e);
      }
    });
  }

  // -------------------------------------------------------
  // WS-knappen
  // -------------------------------------------------------
  function bindWsButton() {
    const btn = $('[data-id="btn-ws-dev"]');
    if (!btn) {
      log("hittar inte WS-knapp i DOM:en");
      return;
    }
    btn.addEventListener("click", handleWsClick);
    log("WS-knapp bunden");
  }

  async function handleWsClick(ev) {
    ev.preventDefault();

    if (!window.WS_DEV) {
      log("WS_DEV finns inte på window");
      return;
    }

    const createBtn = $('[data-id="btn-create"]');
    const storyEl =
      $('[data-id="story"]') || document.getElementById("story");
    const promptEl = $('[data-id="prompt"]');
    const heroInput = document.getElementById("hero");
    const ageSel = document.getElementById("age");
    const lengthSel = document.getElementById("length");

    const hero =
      heroInput && heroInput.value
        ? heroInput.value.trim()
        : (window.WS_DEV.load() &&
           window.WS_DEV.load().meta &&
           window.WS_DEV.load().meta.hero) ||
          "hjälten";

    const ageVal = ageSel && ageSel.value ? ageSel.value : "";
    const lenVal = lengthSel && lengthSel.value ? lengthSel.value : "";

    const newWish =
      promptEl && promptEl.value ? promptEl.value.trim() : "";

    // 1) Ladda eller skapa bok
    let state = window.WS_DEV.loadOrCreateFromForm();

    // 2) Bygg WS-prompt (inkl. recap + nytt önskemål)
    const wsPrompt = window.WS_DEV.buildWsPrompt(state, newWish);

    const body = {
      age: ageVal,
      hero: hero,
      length: lenVal,
      lang: "sv",
      prompt: wsPrompt
    };

    // Öka requestId för varje klick — SENASTE vinner
    const myRequestId = ++latestRequestId;
    log("WS-dev requestId:", myRequestId);

    setSpinner(true, "Skapar kapitel (WS dev)...");
    if (createBtn) createBtn.disabled = true;

    try {
      const res = await fetch("/api/generate_story", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(body)
      });

      const raw = await res.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        throw new Error("Kunde inte tolka JSON: " + raw.slice(0, 200));
      }

      if (!data || (!data.story && !data.text)) {
        throw new Error("Saknar story-fält i svar");
      }

      // Kolla om detta svar fortfarande är det senaste
      if (myRequestId !== latestRequestId) {
        log(
          "ignorerar föråldrat WS-svar",
          "mitt:", myRequestId,
          "senaste:", latestRequestId
        );
        return; // finally körs ändå, spinner stängs
      }

      const chapterText = data.story || data.text;
      if (storyEl) storyEl.textContent = chapterText;

      // 3) Uppdatera bok + spara
      state = window.WS_DEV.addChapterAndSave(state, chapterText, newWish);

      const count = state.chapters ? state.chapters.length : 0;
      log("chapters now:", Array.from({ length: count }, (_, i) => i + 1));
    } catch (err) {
      console.error("[WS DEV] fel:", err);
      const errorEl = $('[data-id="error"]');
      if (errorEl) {
        errorEl.textContent =
          "Något gick fel i WS dev: " + (err.message || err);
      }
    } finally {
      setSpinner(false);
      if (createBtn) createBtn.disabled = false;
    }
  }

  // -------------------------------------------------------
  // Init
  // -------------------------------------------------------
  window.addEventListener("DOMContentLoaded", function () {
    bindWsButton();
    hookResetButton();
  });
})();
