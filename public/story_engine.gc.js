// ==========================================================================
// BN-KIDS — STORY ENGINE (GC v6.0)
// Frontend-shim mot backend /api/generate
// - Läser worldState-meta (ålder, längd, hjälte, kapitelIndex)
// - Anropar Cloudflare Pages Function /api/generate
// - Returnerar ren text till ws_button.gc.js
//
// Viktigt:
//  - All "hjärna" (flow, moralnivå, kapitelton, kapitelroll) sitter i backend
//    i functions/generate.js (GC v6).
//  - Denna fil ska vara tunn och stabil.
// ==========================================================================

(function (global) {
  "use strict";

  const ENGINE_VERSION = "bn-story-engine-gc-v6.0";

  const log = (...a) => console.log("[STORY GC]", ...a);

  // ------------------------------------------------------------
  // Hjälpare
  // ------------------------------------------------------------

  async function callApi(apiUrl, payload) {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    let data;
    try {
      data = await res.json();
    } catch (err) {
      console.error("[STORY GC] Kunde inte parsa JSON:", err);
      throw new Error("Kunde inte läsa svar från API:t.");
    }

    if (!res.ok || !data || data.ok === false) {
      const msg =
        (data && (data.error || data.message)) ||
        `API-svar med status ${res.status}`;
      throw new Error(msg);
    }

    return data;
  }

  function extractPromptFromWorldState(ws) {
    if (!ws) return "";
    return (
      ws._userPrompt ||
      ws.last_prompt ||
      (ws.meta && ws.meta.originalPrompt) ||
      ""
    );
  }

  function extractMeta(ws) {
    const meta = (ws && ws.meta) || {};

    const heroName = meta.hero || "hjälten";
    const ageGroup =
      meta.ageValue || meta.age || meta.ageLabel || "7-8 år";
    const lengthPreset =
      meta.lengthValue || meta.length || meta.lengthLabel || "medium";
    const storyMode = ws.story_mode || "chapter_book";
    const totalChapters = Number(meta.totalChapters || 8);

    return { heroName, ageGroup, lengthPreset, storyMode, totalChapters };
  }

  // ------------------------------------------------------------
  // HUVUD: generateChapter
  // Anropas från ws_button.gc.js
  // ------------------------------------------------------------

  async function generateChapter(opts) {
    const {
      apiUrl = "/api/generate",
      worldState,
      storyState = {},
      chapterIndex = 1
    } = opts || {};

    if (!worldState) {
      throw new Error("BNStoryEngine: worldState saknas.");
    }

    const ws = worldState;
    const prompt = extractPromptFromWorldState(ws);
    const {
      heroName,
      ageGroup,
      lengthPreset,
      storyMode,
      totalChapters
    } = extractMeta(ws);

    const payload = {
      prompt,
      heroName,
      ageGroup,
      lengthPreset,
      storyMode,
      chapterIndex,
      worldState: ws,
      totalChapters
    };

    log("Anropar backend /api/generate", {
      chapterIndex,
      storyMode,
      ageGroup,
      lengthPreset
    });

    const data = await callApi(apiUrl, payload);
    const storyText = (data && data.story) || "";

    return {
      chapterText: storyText,
      storyState: storyState || {},
      engineVersion: ENGINE_VERSION
    };
  }

  // ------------------------------------------------------------
  // Exportera globalt
  // ------------------------------------------------------------
  global.BNStoryEngine = {
    generateChapter,
    ENGINE_VERSION
  };

  log("story_engine.gc.js laddad (GC v6.0)");
})(window);
