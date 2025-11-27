// ==========================================================
// BN-KIDS — WS BUTTON (GC v7.0 – StoryEngine-läge)
// Kopplar UI → BNWorldState (GC v6) → generateStoryWithIPFilter
//
// Viktigt:
// - Använder BN Story Engine (story_engine.gc.js + generateStory.ip.gc.js)
//   för kapitel-flöde och ton (det som funkade förut).
// - Backend /api/generate används INTE här – istället /api/generate_story
//   via StoryEngine.
// - worldstate.gc.v6 används bara för kapitelindex + meta + history.
//
// Kräver att följande är laddat i index.html (GC-filer):
//   <script src="/ip_blocklist.js"></script>
//   <script src="/ip_sanitizer.js"></script>
//   <script src="/story_engine.gc.js"></script>
//   <script src="/generateStory.ip.gc.js"></script>
//   <script src="/worldstate.gc.js"></script>
//   <script src="/ws_button.gc.js"></script>
// ==========================================================

(function (global) {
  "use strict";

  const log = (...args) => console.log("[WS GC v7]", ...args);

  const BNWorldState = global.BNWorldState;
  const generateStoryWithIPFilter = global.generateStoryWithIPFilter;

  if (!BNWorldState) {
    console.error("[WS GC v7] BNWorldState saknas – kontrollera worldstate.gc.js");
  }
  if (typeof generateStoryWithIPFilter !== "function") {
    console.error(
      "[WS GC v7] generateStoryWithIPFilter saknas – kontrollera att generateStory.ip.gc.js laddas före ws_button.gc.js"
    );
  }

  let latestRequestId = 0;
  // StoryEngine intern state (behöver inte ligga i worldstate, räcker i minnet)
  let storyStateMemory = null;

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

    if (spinner) {
      spinner.dataset.active = active ? "1" : "0";
      spinner.style.display = active ? "block" : "none";
      const textSpan = spinner.querySelector('[data-id="spinner-text"]');
      if (textSpan && msg) textSpan.textContent = msg;
    }

    if (errorEl) {
      if (active) {
        errorEl.textContent = "";
        errorEl.style.display = "none";
      } else if (!errorEl.textContent) {
        errorEl.style.display = "none";
      }
    }
  }

  function showError(msg) {
    const errorEl = $('[data-id="error"]');
    if (!errorEl) return;
    errorEl.textContent = msg || "Något gick fel.";
    errorEl.style.display = "block";
  }

  function getFormValues() {
    const heroInput = document.getElementById("hero") || $('[data-id="hero"]');
    const ageSel = document.getElementById("age") || $('[data-id="age"]');
    const lengthSel = document.getElementById("length") || $('[data-id="length"]');
    const promptEl = document.getElementById("prompt") || $('[data-id="prompt"]');

    const hero =
      heroInput && heroInput.value ? heroInput.value.trim() : "";

    const ageValue = ageSel && ageSel.value ? ageSel.value : "";
    const ageLabel =
      ageSel &&
      ageSel.selectedOptions &&
      ageSel.selectedOptions[0] &&
      ageSel.selectedOptions[0].textContent
        ? ageSel.selectedOptions[0].textContent.trim()
        : ageValue || "9–10 år";

    const lengthValue =
      lengthSel && lengthSel.value ? lengthSel.value : "";
    const lengthLabel =
      lengthSel &&
      lengthSel.selectedOptions &&
      lengthSel.selectedOptions[0] &&
      lengthSel.selectedOptions[0].textContent
        ? lengthSel.selectedOptions[0].textContent.trim()
        : lengthValue || "Medium";

    const prompt =
      promptEl && promptEl.value ? promptEl.value.trim() : "";

    return {
      hero: hero || "hjälten",
      ageValue,
      ageLabel,
      lengthValue,
      lengthLabel,
      prompt
    };
  }

  function makeShortSummary(chapterText) {
    if (!chapterText) return "";
    const clean = chapterText.replace(/\s+/g, " ").trim();
    if (clean.length <= 350) return clean;
    return clean.slice(0, 320) + " …";
  }

  // Rensa-knapp → nollställ worldstate + text
  function hookResetButton() {
    const clearBtn =
      document.getElementById("clear-transcript") ||
      $('[data-id="btn-clear-transcript"]');

    const storyEl =
      $('[data-id="story"]') || document.getElementById("story-output");

    if (!clearBtn) {
      log("Hittar ingen Rensa-knapp (clear-transcript / btn-clear-transcript)");
      return;
    }

    clearBtn.addEventListener("click", () => {
      try {
        if (BNWorldState && typeof BNWorldState.reset === "function") {
          BNWorldState.reset();
        }
        // Nollställ även StoryEngine-intern state
        storyStateMemory = null;

        if (storyEl) storyEl.textContent = "";
        const promptEl =
          document.getElementById("prompt") || $('[data-id="prompt"]');
        if (promptEl) promptEl.value = "";
        log("Worldstate + text reset via Rensa-knappen (v7)");
      } catch (e) {
        console.warn("[WS GC v7] reset via Rensa misslyckades", e);
      }
    });
  }

  function bindCreateButtons() {
    const btnMain = $('[data-id="btn-create"]');
    const btnDev = $('[data-id="btn-ws-dev"]');

    if (!btnMain && !btnDev) {
      log("Hittar varken btn-create eller btn-ws-dev i DOM:en");
      return;
    }

    if (btnMain) {
      btnMain.addEventListener("click", (e) => {
        e.preventDefault();
        handleCreateClick({ mode: "normal" });
      });
    }

    if (btnDev) {
      btnDev.addEventListener("click", (e) => {
        e.preventDefault();
        log("WS DEV-läge aktiverat (StoryEngine, extra logg).");
        handleCreateClick({ mode: "dev" });
      });
    }

    log("Skapa/kapitel-knappar bundna (v7)");
  }

  // -------------------------------------------------------
  // HUVUD: klick på "Skapa saga" / "Skapa saga (WS dev)"
  // -------------------------------------------------------
  async function handleCreateClick({ mode } = { mode: "normal" }) {
    if (!BNWorldState) {
      console.error("[WS GC v7] BNWorldState saknas, kan inte fortsätta.");
      showError("Tekniskt fel: worldstate saknas.");
      return;
    }
    if (typeof generateStoryWithIPFilter !== "function") {
      console.error("[WS GC v7] generateStoryWithIPFilter saknas.");
      showError("Tekniskt fel: berättelsemotorn saknas.");
      return;
    }

    const btnMain = $('[data-id="btn-create"]');
    const btnDev = $('[data-id="btn-ws-dev"]');
    const storyEl =
      $('[data-id="story"]') || document.getElementById("story-output");

    const { hero, ageValue, ageLabel, lengthValue, lengthLabel, prompt } =
      getFormValues();

    // 1) Läs befintligt state
    let ws = BNWorldState.load();
    const hasHistory =
      ws.previousChapters &&
      Array.isArray(ws.previousChapters) &&
      ws.previousChapters.length > 0;

    const isNewBook = !hasHistory;

    // 2) Om ny bok → reset + sätt meta + prompt + chapterIndex 1
    if (isNewBook) {
      ws = BNWorldState.reset();
      storyStateMemory = null; // även StoryEngine state nollas

      // totalChapters efter längd-val
      let totalChapters = 9;
      const lv = (lengthValue || "").toLowerCase();
      if (lv.includes("short")) totalChapters = 6;
      else if (lv.includes("long")) totalChapters = 12;

      ws.meta.hero = hero;
      ws.meta.age = ageValue || ageLabel;
      ws.meta.ageValue = ageValue || "";
      ws.meta.ageLabel = ageLabel;
      ws.meta.length = lengthValue || lengthLabel;
      ws.meta.lengthValue = lengthValue || "";
      ws.meta.lengthLabel = lengthLabel;
      ws.meta.totalChapters = totalChapters;

      ws.story_mode = "chapter_book";
      ws.chapterIndex = 1;
      ws.previousChapters = [];
      ws.previousSummary = "";

      BNWorldState.updateMeta(ws.meta);
      BNWorldState.updatePrompt(prompt || "");
      ws = BNWorldState.load();

      log("Ny bok initierad (StoryEngine):", {
        hero: ws.meta.hero,
        age: ws.meta.age,
        length: ws.meta.length,
        totalChapters: ws.meta.totalChapters
      });
    } else {
      // Fortsättning på befintlig bok
      BNWorldState.updateMeta({
        hero,
        age: ageValue || ageLabel,
        ageValue,
        ageLabel,
        length: lengthValue || lengthLabel,
        lengthValue,
        lengthLabel
      });

      // Prompt-hantering:
      // - Ny prompt → updatePrompt
      // - Tom prompt → behåll senaste last_prompt, men uppdatera _userPrompt
      if (prompt) {
        BNWorldState.updatePrompt(prompt);
      } else {
        BNWorldState.updatePrompt(ws.last_prompt || "");
      }

      BNWorldState.nextChapter();
      ws = BNWorldState.load();
      log("Fortsätter befintlig bok, kapitel:", ws.chapterIndex);
    }

    const currentChapterIndex = ws.chapterIndex || 1;
    const storyMode = ws.story_mode || "chapter_book";

    const apiPrompt = ws._userPrompt || ws.last_prompt || prompt || "";
    if (!apiPrompt) {
      showError("Barnets idé/prompt saknas.");
      return;
    }

    // 3) Request-lock
    const myRequestId = ++latestRequestId;
    setSpinner(true, "Skapar kapitel …");
    if (btnMain) btnMain.disabled = true;
    if (btnDev) btnDev.disabled = true;

    try {
      // *********** HÄR KOPPLAR VI IN BN STORY ENGINE ***********
      const engineResult = await generateStoryWithIPFilter(apiPrompt, {
        worldState: ws,
        storyState: storyStateMemory || {},
        chapterIndex: currentChapterIndex,
        // Denna endpoint ska redan finnas sedan tidigare setup
        apiUrl: "/api/generate_story"
      });

      let chapterText =
        engineResult && engineResult.text
          ? String(engineResult.text).trim()
          : "";

      if (!chapterText) {
        throw new Error("Tomt svar från berättelsemotorn.");
      }

      // Uppdatera storyStateMemory om StoryEngine skickar tillbaka det
      if (engineResult.storyState) {
        storyStateMemory = engineResult.storyState;
      }

      if (myRequestId !== latestRequestId) {
        log(
          "Ignorerar föråldrat svar. Mitt:",
          myRequestId,
          "senaste:",
          latestRequestId
        );
        return;
      }

      // 4) Skriv ut i UI
      if (storyEl) {
        storyEl.textContent = chapterText;
      }

      // 5) Uppdatera worldstate med kapitel + summary
      BNWorldState.addChapterToHistory(chapterText);
      const shortSummary = makeShortSummary(chapterText);
      BNWorldState.updateSummary(shortSummary);

      log(
        "Kapitel klart (StoryEngine):",
        currentChapterIndex,
        "längd (tecken):",
        chapterText.length
      );
    } catch (err) {
      console.error("[WS GC v7] fel:", err);
      showError(
        "Något gick fel när kapitlet skulle skapas: " +
          (err.message || String(err))
      );
    } finally {
      setSpinner(false);
      if (btnMain) btnMain.disabled = false;
      if (btnDev) btnDev.disabled = false;
    }
  }

  // -------------------------------------------------------
  // Init
  // -------------------------------------------------------
  window.addEventListener("DOMContentLoaded", function () {
    bindCreateButtons();
    hookResetButton();
    log("ws_button.gc.js laddad (GC v7.0, StoryEngine-mode)");
  });
})(window);
