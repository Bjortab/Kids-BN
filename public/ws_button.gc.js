// ==========================================================
// BN-KIDS — WS BUTTON (GC v4.0)
// - Kopplar UI:t till BNWorldState + backend /api/generate
// - Hanterar kapitelIndex, prompt-flöde, recap-historik
// - Request-lock: inga dubbla svar som skriver över varandra
//
// Förväntar sig i DOM:
// - [data-id="btn-create"]  (Skapa saga / nästa kapitel)
// - [data-id="prompt"]      (barnets input)
// - [data-id="story"]       (ut-texten)
// - [data-id="spinner"]     (ladd-indikator)
// - [data-id="error"]       (felmeddelande)
// - #hero, #age, #length    (formfält)
// - #clear-transcript       (Rensa-knapp)
//
// Kräver att worldstate.gc.js är laddad före denna fil.
// Backend: functions/generate.js → POST /api/generate
// ==========================================================

(function (global) {
  "use strict";

  const log = (...args) => console.log("[WS GC]", ...args);

  const BNWorldState = global.BNWorldState;

  if (!BNWorldState) {
    console.error("[WS GC] BNWorldState saknas – kontrollera worldstate.gc.js");
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
    if (spinner) spinner.style.display = active ? "flex" : "none";
    if (errorEl) {
      if (msg) errorEl.textContent = msg;
      else if (!active) errorEl.textContent = "";
    }
  }

  function getFormValues() {
    const heroInput = document.getElementById("hero");
    const ageSel = document.getElementById("age");
    const lengthSel = document.getElementById("length");
    const promptEl = $('[data-id="prompt"]');

    const hero =
      heroInput && heroInput.value ? heroInput.value.trim() : "";

    const ageValue = ageSel && ageSel.value ? ageSel.value : "";
    const ageLabel =
      ageSel &&
      ageSel.selectedOptions &&
      ageSel.selectedOptions[0] &&
      ageSel.selectedOptions[0].textContent
        ? ageSel.selectedOptions[0].textContent.trim()
        : ageValue || "7–8 år";

    const lengthValue =
      lengthSel && lengthSel.value ? lengthSel.value : "";
    const lengthLabel =
      lengthSel &&
      lengthSel.selectedOptions &&
      lengthSel.selectedOptions[0] &&
      lengthSel.selectedOptions[0].textContent
        ? lengthSel.selectedOptions[0].textContent.trim()
        : lengthValue || "Lagom";

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

  // Kort sammanfattning att lägga i worldstate.previousSummary
  function makeShortSummary(chapterText) {
    if (!chapterText) return "";
    const clean = chapterText.replace(/\s+/g, " ").trim();
    if (clean.length <= 350) return clean;
    return clean.slice(0, 320) + " …";
  }

  // -------------------------------------------------------
  // Reset-knapp → rensa story + worldstate
  // -------------------------------------------------------
  function hookResetButton() {
    const clearBtn = document.getElementById("clear-transcript");
    const storyEl =
      $('[data-id="story"]') || document.getElementById("story");
    if (!clearBtn) {
      log("hittar ingen Rensa-knapp (clear-transcript)");
      return;
    }
    clearBtn.addEventListener("click", () => {
      try {
        if (BNWorldState && typeof BNWorldState.reset === "function") {
          BNWorldState.reset();
        }
        if (storyEl) storyEl.textContent = "";
        const promptEl = $('[data-id="prompt"]');
        if (promptEl) promptEl.value = "";
        log("Worldstate + text reset via Rensa-knappen");
      } catch (e) {
        console.warn("[WS GC] reset via Rensa misslyckades", e);
      }
    });
  }

  // -------------------------------------------------------
  // Bind create/next-chapter-knappen
  // -------------------------------------------------------
  function bindCreateButton() {
    const btn = $('[data-id="btn-create"]');
    if (!btn) {
      log("hittar inte btn-create i DOM:en");
      return;
    }
    btn.addEventListener("click", handleCreateClick);
    log("Skapa/kapitel-knapp bunden");
  }

  // -------------------------------------------------------
  // HUVUD: klick på skapa/kapitel-knappen
  // -------------------------------------------------------
  async function handleCreateClick(ev) {
    ev.preventDefault();

    if (!BNWorldState) {
      console.error("[WS GC] BNWorldState saknas, kan inte fortsätta.");
      return;
    }

    const createBtn = $('[data-id="btn-create"]');
    const storyEl =
      $('[data-id="story"]') || document.getElementById("story");
    const errorEl = $('[data-id="error"]');

    if (errorEl) errorEl.textContent = "";

    const {
      hero,
      ageValue,
      ageLabel,
      lengthValue,
      lengthLabel,
      prompt
    } = getFormValues();

    // 1) Ladda befintligt worldstate
    let ws = BNWorldState.load();

    const hasHistory =
      ws.previousChapters &&
      Array.isArray(ws.previousChapters) &&
      ws.previousChapters.length > 0;

    const isNewBook = !hasHistory;

    // 2) Ny bok → reset + sätt meta + första prompt
    if (isNewBook) {
      ws = BNWorldState.reset();
      ws.meta.hero = hero;
      ws.meta.age = ageValue || ageLabel;
      ws.meta.ageValue = ageValue || "";
      ws.meta.ageLabel = ageLabel;
      ws.meta.length = lengthValue || lengthLabel;
      ws.meta.lengthValue = lengthValue || "";
      ws.meta.lengthLabel = lengthLabel;
      ws.meta.originalPrompt = prompt || "";
      ws.meta.totalChapters = ws.meta.totalChapters || 10; // t.ex. 10 kap som standard
      ws.story_mode = "chapter_book";
      ws.chapterIndex = 0; // startar på 0, vi höjer till 1 nedan

      BNWorldState.updateMeta(ws.meta);
      BNWorldState.updatePrompt(prompt || "");
      ws = BNWorldState.nextChapter(); // kapitelIndex = 1
    } else {
      // Fortsättning på befintlig bok
      ws.meta.hero = hero || ws.meta.hero || "hjälten";
      ws.meta.age = ageValue || ws.meta.age || ageLabel;
      ws.meta.ageValue = ageValue || ws.meta.ageValue || "";
      ws.meta.ageLabel = ageLabel || ws.meta.ageLabel || "7–8 år";
      ws.meta.length = lengthValue || ws.meta.length || lengthLabel;
      ws.meta.lengthValue =
        lengthValue || ws.meta.lengthValue || "";
      ws.meta.lengthLabel =
        lengthLabel || ws.meta.lengthLabel || "Lagom";

      BNWorldState.updateMeta(ws.meta);

      // Om prompten ändrats → uppdatera
      if (prompt && prompt !== ws.last_prompt) {
        ws = BNWorldState.updatePrompt(prompt);
      }

      // Öka kapitelindex
      ws = BNWorldState.nextChapter();
    }

    const currentChapterIndex = ws.chapterIndex || 1;

    // Request-lock
    const myRequestId = ++latestRequestId;
    log("RequestId:", myRequestId, "kapitel:", currentChapterIndex);

    setSpinner(true, "Skapar kapitel …");
    if (createBtn) createBtn.disabled = true;

    try {
      // 3) Bygg payload till backend /api/generate
      const body = {
        prompt: ws._userPrompt || ws.last_prompt || "",
        heroName: ws.meta.hero || "hjälten",
        age: ws.meta.ageValue || ws.meta.ageLabel || "7–8 år",
        lengthPreset: ws.meta.lengthValue || ws.meta.lengthLabel || "medium",
        storyMode: ws.story_mode || "chapter_book",
        chapterIndex: currentChapterIndex,
        worldState: ws,
        totalChapters: ws.meta.totalChapters || 10
      };

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(body)
      });

      const rawText = await res.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch (e) {
        throw new Error(
          "Kunde inte tolka JSON-svar: " + rawText.slice(0, 200)
        );
      }

      if (!data || !data.ok) {
        throw new Error(
          data && data.error
            ? data.error
            : "Okänt fel från /api/generate"
        );
      }

      const chapterText = data.story || "";
      if (!chapterText) {
        throw new Error("Tomt kapitel tillbaka från motorn.");
      }

      // 4) Kolla request-lock (ignorera gamla svar)
      if (myRequestId !== latestRequestId) {
        log(
          "Ignorerar föråldrat svar. Mitt:",
          myRequestId,
          "senaste:",
          latestRequestId
        );
        return;
      }

      // 5) Skriv till UI
      if (storyEl) {
        storyEl.textContent = chapterText;
      }

      // 6) Uppdatera worldstate: historik + short summary
      BNWorldState.addChapterToHistory(chapterText);
      const shortSummary = makeShortSummary(chapterText);
      BNWorldState.updateSummary(shortSummary);

      log(
        "Kapitel klart:",
        currentChapterIndex,
        "längd:",
        chapterText.length
      );
    } catch (err) {
      console.error("[WS GC] fel:", err);
      if (errorEl) {
        errorEl.textContent =
          "Något gick fel när kapitlet skulle skapas: " +
          (err.message || err);
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
    bindCreateButton();
    hookResetButton();
  });
})(window);
