// ==========================================================
// BN-KIDS WS DEV — ws_button.dev.js (v3)
// Extra knapp: "Skapa saga (WS dev)" för kapitelbok
// Använder window.WS_DEV från worldstate.dev.js
// ==========================================================

(function () {
  "use strict";

  const BTN_ID = "btn-ws-dev";

  function log(...args) {
    console.log("[WS DEV]", ...args);
  }

  function q(sel) {
    return document.querySelector(sel);
  }

  function setError(text) {
    const el = q("[data-id='error']");
    if (!el) return;
    el.textContent = text || "";
    el.style.display = text ? "block" : "none";
  }

  function showSpinner(show, text) {
    const wrap = q("[data-id='spinner']");
    const status = q("[data-id='status']");
    if (!wrap) return;
    wrap.style.display = show ? "flex" : "none";
    if (status && text) status.textContent = text;
  }

  function setButtonsDisabled(disabled) {
    const normalBtn = q("[data-id='btn-create']");
    const ttsBtn = q("[data-id='btn-tts']");
    const wsBtn = document.getElementById(BTN_ID);
    if (normalBtn) normalBtn.disabled = disabled;
    if (ttsBtn) ttsBtn.disabled = disabled;
    if (wsBtn) wsBtn.disabled = disabled;
  }

  // -------------------------------------------------------
  // Huvudhandler för WS-knappen
  // -------------------------------------------------------
  async function handleClick(ev) {
    ev.preventDefault();

    if (!window.WS_DEV) {
      console.warn("[WS DEV] saknar WS_DEV-objekt");
      setError("Tekniskt fel: WS_DEV saknas.");
      return;
    }

    try {
      setError("");
      showSpinner(true, "Skapar kapitel med world state …");
      setButtonsDisabled(true);

      // 1) Ladda ev tidigare bok
      let state = window.WS_DEV.load();

      // 2) Om ingen bok: skapa ny från form
      if (!state) {
        log("ingen bok i storage → skapar ny");
        state = window.WS_DEV.createWorldFromForm();
      }

      // 3) Läs in ev nytt önskemål från prompt-fältet
      const promptEl = q("[data-id='prompt']");
      const wish = promptEl && promptEl.value
        ? promptEl.value.trim()
        : "";

      // Spara senaste önskemålet i state (för info)
      state.lastWish = wish;

      // 4) Bygg WS-prompt (recap + ev önskemål)
      const wsPrompt = window.WS_DEV.buildWsPrompt(state, { wish });

      // 5) Förbered body till /api/generate_story
      const ageSel = document.getElementById("age");
      const lengthSel = document.getElementById("length");

      const ageValue = ageSel && ageSel.value ? ageSel.value : "";
      const lengthVal = lengthSel && lengthSel.value ? lengthSel.value : "";

      const body = {
        age: ageValue,
        hero: state.meta && state.meta.hero ? state.meta.hero : "hjälten",
        length: lengthVal,
        lang: "sv",
        prompt: wsPrompt,
        agentName: "ws-dev"
      };

      // 6) Anropa samma endpoint som vanliga "Skapa saga"
      const res = await fetch("/api/generate_story", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.warn("[WS DEV] generate_story fel", res.status, txt);
        throw new Error("Kunde inte skapa kapitel (ws-dev): " + res.status);
      }

      const data = await res.json().catch(() => null);
      const storyText =
        (data && data.story) ||
        (data && data.text) ||
        "";

      if (!storyText) {
        console.warn("[WS DEV] tom story-respons", data);
        throw new Error("Tom berättelse från servern.");
      }

      // 7) Lägg till kapitel i state + spara
      state = window.WS_DEV.addChapterToWS(state, storyText);
      window.WS_DEV.save(state);

      log("chapters now:", (state.chapters || []).map((c, i) => i + 1));

      // 8) Visa aktuellt kapitel i UI:t
      const storyEl = q("[data-id='story']");
      if (storyEl) storyEl.textContent = storyText;

    } catch (err) {
      console.error("[WS DEV] fel i ws-knapp", err);
      setError(err && err.message ? err.message : "Tekniskt fel i WS dev.");
    } finally {
      showSpinner(false);
      setButtonsDisabled(false);
    }
  }

  // -------------------------------------------------------
  // Binda knappen när DOM är klar
  // -------------------------------------------------------
  function bindWsButton() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) {
      console.warn("[WS DEV] hittar inte WS-knapp i DOM: id=", BTN_ID);
      return;
    }
    btn.addEventListener("click", handleClick);
    log("WS-knapp bunden");
  }

  document.addEventListener("DOMContentLoaded", bindWsButton);
})();
