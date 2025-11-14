// ==========================================================
// BN-KIDS WS DEV — ws_button.dev.js (v3b)
// Hanterar "Skapa saga (WS dev)"-knappen
// ==========================================================

(function () {
  // Egen liten spinner-hanterare så vi inte rör app.js
  function wsShowSpinner(on) {
    const el = document.querySelector('[data-id="spinner"]');
    if (!el) return;
    el.style.display = on ? "flex" : "none";
  }

  function wsSetError(msg) {
    const el = document.querySelector('[data-id="error"]');
    if (!el) return;
    el.textContent = msg || "";
    el.style.display = msg ? "block" : "none";
  }

  function wsGetStoryElement() {
    return document.querySelector('[data-id="story"]') ||
           document.getElementById("story-output") ||
           null;
  }

  function wsReadFormValues() {
    const ageSel    = document.getElementById("age");
    const heroInput = document.getElementById("hero");
    const lengthSel = document.getElementById("length");
    const promptEl  = document.querySelector("[data-id='prompt']");

    return {
      age:    ageSel    && ageSel.value    ? ageSel.value    : "",
      hero:   heroInput && heroInput.value ? heroInput.value.trim() : "",
      length: lengthSel && lengthSel.value ? lengthSel.value : "",
      prompt: promptEl  && promptEl.value  ? promptEl.value.trim()  : ""
    };
  }

  async function handleWsClick(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();

    if (!window.WS_DEV) {
      console.warn("[WS DEV] WS_DEV saknas på window");
      wsSetError("Tekniskt fel: WS_DEV saknas.");
      return;
    }

    try {
      wsSetError("");
      wsShowSpinner(true);

      const formWorld  = window.WS_DEV.createWorldFromForm();
      const formValues = wsReadFormValues();

      // Ladda ev befintlig bok
      let state = window.WS_DEV.load();
      if (!state) {
        state = formWorld;                 // Första kapitlet
      } else {
        // Uppdatera meta om användaren ändrat ålder/hjälte/längd/prompt
        state.meta = formWorld.meta;
        if (formWorld.last_prompt) {
          state.last_prompt = formWorld.last_prompt;
        }
      }

      const isFirstChapter = !state.chapters || state.chapters.length === 0;

      // "Önskan mitt i" – nuvarande promptfält som önskan
      const userWish = isFirstChapter ? "" : formValues.prompt;

      const wsPrompt = window.WS_DEV.buildWsPrompt(state, userWish);

      // Bygg body mot samma backend-endpoint som vanliga createstory
      const body = {
        age:    formValues.age,
        hero:   formValues.hero,
        length: formValues.length,
        prompt: wsPrompt
      };

      const res = await fetch("/api/generate_story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.error("[WS DEV] generate_story svarade", res.status, txt);
        throw new Error("Kunde inte skapa kapitel (serverfel).");
      }

      let data;
      try {
        data = await res.json();
      } catch (e) {
        const txt = await res.text().catch(() => "");
        console.error("[WS DEV] kunde inte tolka JSON", e, txt);
        throw new Error("Tekniskt fel: ogiltigt svar från sagomotorn.");
      }

      if (!data || !data.story) {
        console.warn("[WS DEV] svar saknar story-fält", data);
        throw new Error("Kunde inte skapa kapitel (saknar story).");
      }

      const storyText = String(data.story || "").trim();
      const storyEl = wsGetStoryElement();
      if (storyEl) {
        storyEl.textContent = storyText;
      }

      // Lägg till kapitlet i world state och spara
      state = window.WS_DEV.addChapterToWS(state, storyText);
      window.WS_DEV.save(state);

      console.log(
        "[WS DEV] chapters now:",
        Array.isArray(state.chapters)
          ? state.chapters.map((c, i) => i + 1)
          : []
      );

    } catch (err) {
      console.error("[WS DEV] fel i WS-flödet", err);
      wsSetError(err && err.message
        ? err.message
        : "Något gick fel i WS-läget.");
    } finally {
      wsShowSpinner(false);
    }
  }

  // -------------------------------------------------------
  // Binda knappen när sidan är laddad
  // -------------------------------------------------------
  function bindWsButton() {
    const btn = document.querySelector('[data-id="btn-ws-dev"]');
    if (!btn) {
      console.warn("[WS DEV] hittar inte btn-ws-dev i DOM:en");
      return;
    }
    btn.addEventListener("click", handleWsClick);
    console.log("[WS DEV] WS-knapp bunden");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindWsButton);
  } else {
    bindWsButton();
  }

})();
