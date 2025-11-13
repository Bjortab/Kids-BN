// ==========================================================
// BN-KIDS WS DEV — ws_button.dev.js (v2.1)
// Extra blå knapp: "Skapa saga (WS dev)"
// Återanvänder befintlig createstory()-logik + TTS
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

  // Se till att vi har ett world state i localStorage
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

  function handleWsClick(ev) {
    try { ev.preventDefault(); } catch (e) {}

    if (!window.WS_DEV) {
      console.warn("[WS DEV] WS_DEV saknas – avbryter");
      return;
    }
    if (typeof window.createstory !== "function") {
      console.warn("[WS DEV] window.createstory saknas – kan inte trigga normal flöde");
      return;
    }

    const textarea = getPromptTextarea();
    if (!textarea) {
      console.warn("[WS DEV] hittar inget prompt-fält");
      return;
    }

    // 1) Säkerställ world state
    let state = ensureWorldState();
    if (!state) return;

    // 2) Bygg WS-prompt
    const wsPrompt = window.WS_DEV.buildWsPrompt(state);
    textarea.value = wsPrompt;

    // 3) Kör normal "Skapa saga"-logik
    log("Kör createstory() med WS-prompt …");
    try {
      window.createstory();
    } catch (e) {
      console.error("[WS DEV] fel när createstory() kördes", e);
      return;
    }

    // 4) Efter en stund: läs ut texten som faktiskt skrevs och lägg till som nytt kapitel
    setTimeout(function () {
      try {
        const storyEl = getStoryElement();
        if (!storyEl) {
          console.warn("[WS DEV] hittar inget story-element att läsa ifrån");
          return;
        }
        const txt = (storyEl.textContent || storyEl.innerText || "").trim();
        if (!txt) {
          console.warn("[WS DEV] inga story-texter att spara i WS");
          return;
        }

        let s = window.WS_DEV.load() || state;
        s = window.WS_DEV.addChapterToWS(s, txt);
        window.WS_DEV.save(s);

        log("Kapitel sparat i WS, antal kapitel:", s && s.chapters ? s.chapters.length : "?");
      } catch (e) {
        console.warn("[WS DEV] kunde inte uppdatera world state efter kapitel", e);
      }
    }, 4000); // 4 sekunder efter klick – kan justeras vid behov
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
    // Vänta in att app.js hunnit lägga window.createstory
    let tries = 0;
    const iv = setInterval(function () {
      tries++;
      if (typeof window.createstory === "function") {
        clearInterval(iv);
        bindWsButton();
      } else if (tries > 40) { // ~4 sekunder
        clearInterval(iv);
        console.warn("[WS DEV] gav upp att hitta window.createstory");
      }
    }, 100);
  });
})();
