// ===============================================================
// BN-KIDS — STORY ENGINE (GC-RESTORE v1)
// ---------------------------------------------------------------
// Detta är en REN och LÅG-NIVÅ engine som INTE överstyr WS-systemet.
//
// Syfte:
//  - INGA egna kapitelmallar
//  - INGA egna recaps
//  - INGA egna strukturscheman
//  - INGEN egen åldersstyrning
//  - INGA extra krav som kan sabotera flow
//
// WS_DEV (worldstate.dev.js) bygger hela kapitlet: recap, längd, logik.
// Den här filen skickar bara prompten vidare till /api/generate_story,
// tar emot svaret och ger tillbaka det oförändrat (förutom trim).
//
// Exponeras som: window.BNStoryEngine
// ===============================================================

(function (global) {
  "use strict";

  const ENGINE_VERSION = "bn-story-engine-gc-restore-v1";

  // --------------------------------------------------------------
  // API-ANROP — gör absolut inget extra
  // --------------------------------------------------------------
  async function callApi(apiUrl, payload) {
    const r = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });

    let raw;
    try {
      raw = await r.json();
    } catch (_) {
      raw = await r.text();
    }
    return raw;
  }

  // --------------------------------------------------------------
  // Extrahera text från API-svar (OpenAI / Mistral / egen backend)
  // --------------------------------------------------------------
  function extractModelText(apiResponse) {
    if (!apiResponse) return "";

    if (typeof apiResponse.story === "string") return apiResponse.story;
    if (typeof apiResponse.text === "string") return apiResponse.text;
    if (typeof apiResponse === "string") return apiResponse;

    try {
      if (
        apiResponse.choices &&
        apiResponse.choices[0] &&
        apiResponse.choices[0].message &&
        typeof apiResponse.choices[0].message.content === "string"
      ) {
        return apiResponse.choices[0].message.content;
      }
    } catch (_) {}

    return JSON.stringify(apiResponse);
  }

  // --------------------------------------------------------------
  // Trim till hel mening (tar bort rå output som slutar mitt i)
  // --------------------------------------------------------------
  function trimToWholeSentence(text) {
    if (!text) return "";
    let t = text.trim();
    const lastDot = Math.max(t.lastIndexOf("."), t.lastIndexOf("!"), t.lastIndexOf("?"));
    if (lastDot !== -1) return t.slice(0, lastDot + 1);
    return t;
  }

  // --------------------------------------------------------------
  // HUVUD: generateChapter
  // Gör: skickar bara prompten vidare → tar emot text → returnerar
  // --------------------------------------------------------------
  async function generateChapter(opts) {
    const {
      apiUrl = "/api/generate_story",
      worldState,
      storyState = {},
      chapterIndex = 1
    } = opts;

    if (!worldState) throw new Error("BNStoryEngine: worldState saknas.");

    const payload = {
      prompt: worldState._finalPrompt || "",   // WS_DEV sätter detta
      worldState,
      storyState,
      chapterIndex,
      engineVersion: ENGINE_VERSION
    };

    // -- 1) Anropa API --
    const apiRaw = await callApi(apiUrl, payload);

    // -- 2) Ta ut ren text --
    let chapterText = extractModelText(apiRaw);

    // -- 3) Trimma snyggt --
    chapterText = trimToWholeSentence(chapterText);

    // -- 4) Returnera absolut ingenting extra --
    return {
      chapterText,
      storyState,
      engineVersion: ENGINE_VERSION
    };
  }

  // --------------------------------------------------------------
  // Exportera globalt
  // --------------------------------------------------------------
  global.BNStoryEngine = {
    generateChapter,
    ENGINE_VERSION
  };
})(window);
