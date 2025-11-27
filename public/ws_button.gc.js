// ==========================================================
// BN-KIDS — WS BUTTON (GC v7.1)
// Kopplar UI → BNWorldState (GC v7) → backend /api/generate
//
// Fokus i v7.1:
// - Håller kapiteltråden stabil
// - Skickar med promptChanged → backend vet om prompten ändrats
// - Rätt meta (ålder, längd, hjälte, totalChapters)
// - Spinner + felhantering
// - Både "Skapa saga" och "Skapa saga (WS dev)" funkar
//
// Kräver:
//   - worldstate.gc.js (GC v7) laddad före denna
//   - Cloudflare Pages Function: /api/generate (GC v7.x)
// ==========================================================

(function (global) {
  "use strict";

  const log = (...args) => console.log("[WS GC v7.1]", ...args);

  const BNWorldState = global.BNWorldState;
  if (!BNWorldState) {
    console.error("[WS GC v7.1] BNWorldState saknas – kontrollera worldstate.gc.js");
  }

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

    if (spinner) {
      spinner.dataset.active = active ? "1" : "0";
      spinner.style.display = active ? "block" : "none";
      const textSpan = spinner.querySelector('[data-id="spinner-text"]');
      if (textSpan && msg) textSpan.textContent = msg;
    }

    if (errorEl) {
      if (active) {
        // rensa fel när vi startar nytt anrop
        errorEl.textContent = "";
        errorEl.style.display = "none";
      } else if (!active && !errorEl.textContent) {
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
    // Stöd både id="clear-transcript" och data-id="btn-clear-transcript"
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
        if (storyEl) storyEl.textContent = "";
        const promptEl =
          document.getElementById("prompt") || $('[data-id="prompt"]');
        if (promptEl) promptEl.value = "";
        log("Worldstate + text reset via Rensa-knappen");
      } catch (e) {
        console.warn("[WS GC v7.1] reset via Rensa misslyckades", e);
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
      // WS dev kör exakt samma kedja, bara extra logg
      btnDev.addEventListener("click", (e) => {
        e.preventDefault();
        log("WS DEV-läge aktiverat (samma motor, extra logg).");
        handleCreateClick({ mode: "dev" });
      });
    }

    log("Skapa/kapitel-knappar bundna");
  }

  // -------------------------------------------------------
  // HUVUD: klick på "Skapa saga" / "Skapa saga (WS dev)"
  // -------------------------------------------------------
  async function handleCreateClick({ mode } = { mode: "normal" }) {
    if (!BNWorldState) {
      console.error("[WS GC v7.1] BNWorldState saknas, kan inte fortsätta.");
      showError("Tekniskt fel: worldstate saknas.");
      return;
    }

    const btnMain = $('[data-id="btn-create"]');
    const btnDev = $('[data-id="btn-ws-dev"]');
    const storyEl =
      $('[data-id="story"]') || document.getElementById("story-output");

    const { hero, ageValue, ageLabel, lengthValue, lengthLabel, prompt } =
      getFormValues();

    // 1) Läs befintligt state innan vi uppdaterar prompt
    let ws = BNWorldState.load();
    const hasHistory =
      ws.previousChapters &&
      Array.isArray(ws.previousChapters) &&
      ws.previousChapters.length > 0;

    const isNewBook = !hasHistory;

    // Viktigt: räkna ut promptChanged INNAN vi rör last_prompt i worldstate
    const trimmedPrompt = String(prompt || "").trim();
    const promptChanged =
      !!trimmedPrompt && trimmedPrompt !== (ws.last_prompt || "");

    // 2) Om ny bok → reset + sätt meta + prompt + chapterIndex 1
    if (isNewBook) {
      ws = BNWorldState.reset();

      // totalChapters efter längd-val
      let totalChapters = 8;
      const lv = (lengthValue || "").toLowerCase();
      if (lv.includes("short")) totalChapters = 6;
      else if (lv.includes("long")) totalChapters = 12;
      else totalChapters = 9;

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

      // Spara första prompten som originalidé
      ws.meta.originalPrompt = trimmedPrompt || "";

      BNWorldState.updateMeta(ws.meta);
      BNWorldState.updatePrompt(trimmedPrompt || "");
      ws = BNWorldState.load();

      log("Ny bok initierad:", {
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

      if (trimmedPrompt) {
        // Detta uppdaterar last_prompt ENDAST om den faktiskt ändrats
        BNWorldState.updatePrompt(trimmedPrompt);
      } else {
        // Ingen ny text i fältet → _userPrompt = senaste last_prompt
        BNWorldState.updatePrompt(ws.last_prompt || "");
      }

      // Nästa kapitel
      BNWorldState.nextChapter();
      ws = BNWorldState.load();
      log("Fortsätter befintlig bok, kapitel:", ws.chapterIndex, "promptChanged:", promptChanged);
    }

    const currentChapterIndex = ws.chapterIndex || 1;
    const storyMode = ws.story_mode || "chapter_book";

    // 3) Request-lock
    const myRequestId = ++latestRequestId;
    setSpinner(true, "Skapar kapitel …");
    if (btnMain) btnMain.disabled = true;
    if (btnDev) btnDev.disabled = true;

    try {
      const apiBody = {
        prompt: ws._userPrompt || ws.last_prompt || trimmedPrompt || "",
        heroName: ws.meta.hero || hero,
        ageGroupRaw: ws.meta.age || ageValue || ageLabel,
        lengthPreset:
          ws.meta.lengthValue ||
          ws.meta.length ||
          lengthValue ||
          "medium",
        storyMode,
        chapterIndex: currentChapterIndex,
        worldState: ws,
        totalChapters: ws.meta.totalChapters || 8,
        // Ny signal till backend: ändrades prompten vid detta klick?
        promptChanged: !!promptChanged
      };

      if (!apiBody.prompt) {
        throw new Error("Barnets idé/prompt saknas.");
      }

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(apiBody)
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(
          "Fel från /api/generate (" + res.status + "): " + txt.slice(0, 300)
        );
      }

      const data = await res.json().catch(() => ({}));
      if (!data || data.ok === false) {
        throw new Error(
          data && data.error ? data.error : "Okänt fel från motorn."
        );
      }

      const chapterText =
        (data.story && String(data.story).trim()) || "";

      if (!chapterText) {
        throw new Error("Tomt svar från berättelsemotorn.");
      }

      // 4) Request-lock check: ignorera föråldrade svar
      if (myRequestId !== latestRequestId) {
        log(
          "Ignorerar föråldrat svar. Mitt:",
          myRequestId,
          "senaste:",
          latestRequestId
        );
        return;
      }

      // 5) Skriv ut i UI
      if (storyEl) {
        storyEl.textContent = chapterText;
      }

      // 6) Uppdatera worldstate med kapitel + summary
      BNWorldState.addChapterToHistory(chapterText);
      const shortSummary = makeShortSummary(chapterText);
      BNWorldState.updateSummary(shortSummary);

      log(
        "Kapitel klart:",
        currentChapterIndex,
        "längd (tecken):",
        chapterText.length
      );
    } catch (err) {
      console.error("[WS GC v7.1] fel:", err);
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
    log("ws_button.gc.js laddad (GC v7.1)");
  });
})(window);
