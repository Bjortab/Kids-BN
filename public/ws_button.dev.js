// ==========================================================
// BN-KIDS WS DEV — ws_button.dev.js (v3)
// Blå knapp: "Skapa saga (WS dev)"
// - Bygger WS-prompt
// - Anropar /api/generate_story direkt
// - Lägger texten i berättelserutan
// - Sparar kapitlet i world state
// ==========================================================

(function () {
  function log() {
    console.log.apply(console, ["[WS DEV]"].concat([].slice.call(arguments)));
  }

  function q(sel) {
    try { return document.querySelector(sel); } catch (e) { return null; }
  }

  function getPromptTextarea() {
    return q("[data-id='prompt']") || document.getElementById("prompt") || q("textarea");
  }

  function getStoryElement() {
    return q("[data-id='story']") || document.getElementById("story-output") || document.getElementById("story");
  }

  function getErrorElement() {
    return q("[data-id='error']") || document.getElementById("error");
  }

  function getSpinnerElement() {
    return q("[data-id='spinner']") || document.getElementById("spinner");
  }

  function setWsError(msg) {
    const el = getErrorElement();
    if (!el) return;
    if (msg) {
      el.textContent = msg;
      el.style.display = "block";
    } else {
      el.textContent = "";
      el.style.display = "none";
    }
  }

  function showWsSpinner() {
    const s = getSpinnerElement();
    if (s) s.style.display = "flex";
  }

  function hideWsSpinner() {
    const s = getSpinnerElement();
    if (s) s.style.display = "none";
  }

  // Hämtar värden från dina select/input (samma ids som app.js)
  function readFormMeta() {
    const ageSel    = document.getElementById("age");
    const heroInput = document.getElementById("hero");
    const lengthSel = document.getElementById("length");

    const ageValue   = ageSel && ageSel.value ? ageSel.value : "";
    const ageText    = (ageSel && ageSel.selectedOptions && ageSel.selectedOptions[0])
      ? ageSel.selectedOptions[0].textContent.trim()
      : "7–8 år";

    let hero = "";
    if (heroInput && typeof heroInput.value === "string") {
      hero = heroInput.value.trim();
    }
    if (!hero) hero = "hjälten";

    const lengthVal  = lengthSel && lengthSel.value ? lengthSel.value : "medium";

    // grov mappning lång/kort → minuter, liknar din befintliga logik
    let mins = 5;
    if (lengthVal === "short") mins = 2;
    else if (lengthVal === "long") mins = 10;

    return { ageValue, ageLabel: ageText, hero, lengthValue: lengthVal, mins };
  }

  // Säkerställ ett world state i localStorage
  function ensureWorldState() {
    if (!window.WS_DEV) {
      console.warn("[WS DEV] WS_DEV saknas på window");
      return null;
    }
    let state = window.WS_DEV.load();
    if (!state) {
      state = window.WS_DEV.createWorldFromForm();
      window.WS_DEV.save(state);
      log("Skapade nytt world state från formulär");
    }
    return state;
  }

  async function handleWsClick(ev) {
    try { ev.preventDefault(); } catch (e) {}

    setWsError("");
    if (!window.WS_DEV) {
      setWsError("WS_DEV saknas (dev-läge).");
      return;
    }

    const textarea = getPromptTextarea();
    const storyEl  = getStoryElement();

    if (!textarea || !storyEl) {
      setWsError("Kunde inte hitta prompt- eller berättelseruta.");
      return;
    }

    // 1) Läs formulär + world state
    const meta  = readFormMeta();
    let state   = ensureWorldState();
    if (!state) {
      setWsError("Kunde inte skapa world state.");
      return;
    }

    // 2) Bygg WS-prompt och skriv in i promptfältet (så du ser vad som går in)
    const wsPrompt = window.WS_DEV.buildWsPrompt(state);
    textarea.value = wsPrompt;

    // 3) Skicka till /api/generate_story
    const body = {
      age_group: meta.ageLabel || "7–8 år",
      mins: meta.mins || 5,
      lang: "sv",
      prompt: wsPrompt,
      agentname: meta.hero || "hjälten"
    };

    showWsSpinner();

    try {
      const res = await fetch("/api/generate_story", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(body)
      });

      const textBody = await res.text();
      let data = {};
      try {
        data = textBody ? JSON.parse(textBody) : {};
      } catch (e) {
        console.warn("[WS DEV] kunde inte tolka JSON, text:", textBody);
        setWsError("Servern skickade ogiltigt svar (inte JSON).");
        return;
      }

      if (!res.ok) {
        console.warn("[WS DEV] generate_story fel:", res.status, data);
        setWsError("Kunde inte skapa kapitel: " + (data.error || res.status));
        return;
      }

      const storyText = (data.story || data.text || "").toString().trim();
      if (!storyText) {
        console.warn("[WS DEV] generate_story OK men saknar story-fält:", data);
        setWsError("Servern gav inget berättelsetext-fält.");
        return;
      }

      // 4) Visa berättelsen i samma ruta som vanligt
      storyEl.textContent = storyText;

      // 5) Uppdatera world state med nytt kapitel
      let s = window.WS_DEV.load() || state;
      s = window.WS_DEV.addChapterToWS(s, storyText);
      window.WS_DEV.save(s);

      log("Kapitel sparat i WS, antal kapitel:", s && s.chapters ? s.chapters.length : "?");
    } catch (err) {
      console.error("[WS DEV] nätverksfel mot /api/generate_story", err);
      setWsError("Nätverksfel när kapitel skulle skapas.");
    } finally {
      hideWsSpinner();
    }
  }

  function bindWsButton() {
    const btn = document.getElementById("btn-ws-dev");
    if (!btn) {
      console.warn("[WS DEV] hittar inte #btn-ws-dev i DOM:en");
      return;
    }
    btn.addEventListener("click", handleWsClick);
    log("WS dev-knapp bunden");
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindWsButton();
  });
})();
