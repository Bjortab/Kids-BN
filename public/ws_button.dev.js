// ==========================================================
// BN-KIDS WS DEV — ws_button.dev.js (GC v10.3)
// - Extra knapp "Skapa saga (WS dev)" som använder worldstate
// - Kopplad till WS_DEV.* (load, buildWsPrompt, addChapterAndSave)
// - Har request-lock så bara SENASTE svaret får skriva till sagarutan
// - Robust mot olika versioner av WS_DEV (fallbacks om metod saknas)
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
  // Hjälpare mot olika WS_DEV-versioner
  // -------------------------------------------------------

  function wsLoadOrCreateFromFormSafe() {
    const WS = window.WS_DEV;
    if (!WS) {
      log("WS_DEV saknas på window");
      return null;
    }

    // Nyare version
    if (typeof WS.loadOrCreateFromForm === "function") {
      return WS.loadOrCreateFromForm();
    }

    // Fallback: gammal version som bara har load + createWorldFromForm
    let state = null;
    if (typeof WS.load === "function") {
      try {
        state = WS.load();
      } catch (e) {
        console.warn("[WS DEV] load() misslyckades", e);
      }
    }

    if (!state && typeof WS.createWorldFromForm === "function") {
      try {
        state = WS.createWorldFromForm();
        if (state && typeof WS.save === "function") {
          WS.save(state);
        }
      } catch (e) {
        console.warn("[WS DEV] createWorldFromForm() misslyckades", e);
      }
    }

    return state;
  }

  function wsAddChapterAndSaveSafe(state, chapterText, wishText) {
    const WS = window.WS_DEV;
    if (!WS) return state;

    // Nyare version
    if (typeof WS.addChapterAndSave === "function") {
      return WS.addChapterAndSave(state, chapterText, wishText);
    }

    // Fallback: gammal version med addChapterToWS + save
    if (typeof WS.addChapterToWS === "function") {
      try {
        let next = WS.addChapterToWS(state, chapterText);
        if (wishText && typeof wishText === "string") {
          next.last_wish = wishText.trim();
        }
        if (typeof WS.save === "function") {
          WS.save(next);
        }
        return next;
      } catch (e) {
        console.warn("[WS DEV] addChapterToWS/save misslyckades", e);
      }
    }

    return state;
  }

  function wsBuildPromptSafe(state, wishText) {
    const WS = window.WS_DEV;
    if (!WS || typeof WS.buildWsPrompt !== "function") {
      console.error("[WS DEV] buildWsPrompt saknas");
      return "";
    }
    try {
      return WS.buildWsPrompt(state, wishText);
    } catch (e) {
      console.error("[WS DEV] buildWsPrompt kastade fel", e);
      return "";
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
      const WS = window.WS_DEV;
      if (!WS || typeof WS.reset !== "function") {
        log("WS_DEV.reset saknas, hoppar över bok-reset");
        return;
      }
      try {
        WS.reset();
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
    log("WS-knapp bunden (GC v10.3, med clone fix + robust WS_DEV-stöd)");
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
        : (window.WS_DEV.load &&
           window.WS_DEV.load() &&
           window.WS_DEV.load().meta &&
           window.WS_DEV.load().meta.hero) ||
          "hjälten";

    const ageVal = ageSel && ageSel.value ? ageSel.value : "";
    const lenVal = lengthSel && lengthSel.value ? lengthSel.value : "";

    const newWish =
      promptEl && promptEl.value ? promptEl.value.trim() : "";

    // 1) Ladda eller skapa bok (robust mot olika WS_DEV-versioner)
    let state = wsLoadOrCreateFromFormSafe();
    if (!state) {
      console.error("[WS DEV] kunde inte ladda eller skapa worldstate");
      const errorEl = $('[data-id="error"]');
      if (errorEl) {
        errorEl.textContent =
          "Kunde inte ladda eller skapa boken (worldstate). Prova att ladda om sidan.";
      }
      return;
    }

    // 2) Bygg WS-prompt (inkl. recap + nytt önskemål)
    const wsPrompt = wsBuildPromptSafe(state, newWish);
    if (!wsPrompt) {
      console.error("[WS DEV] tom WS-prompt — avbryter");
      const errorEl = $('[data-id="error"]');
      if (errorEl) {
        errorEl.textContent =
          "Kunde inte bygga kapitel-prompt. Prova igen eller ladda om sidan.";
      }
      return;
    }

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

      // Stöd både för { story: "..."} och { text: "..." }
      let chapterText = "";
      if (data && typeof data.story === "string") {
        chapterText = data.story;
      } else if (data && typeof data.text === "string") {
        chapterText = data.text;
      } else {
        throw new Error("Saknar story/text-fält i svar");
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

      if (storyEl) storyEl.textContent = chapterText;

      // 3) Uppdatera bok + spara (robust mot olika WS_DEV-versioner)
      state = wsAddChapterAndSaveSafe(state, chapterText, newWish);

      const count = state && state.chapters ? state.chapters.length : 0;
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
