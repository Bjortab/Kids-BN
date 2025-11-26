// ==========================================================================
// BN-KIDS — generateStory.ip.gc.js (GC v6.0)
// IP-filter + sanitization + proxy mot /api/generate
// ==========================================================================

(function (global) {
  "use strict";

  const log = (...a) => console.log("[IP GC]", ...a);

  // ------------------------------------------------------------
  // Förbjudna nyckelord/teman (barnskydd & IP-skydd)
  // ------------------------------------------------------------
  const BLOCKED = [
    "pippi långstrump",
    "harry potter",
    "star wars",
    "spindelmannen",
    "spiderman",
    "batman",
    "frost",
    "elsa",
    "anna från frost",
    "disney",
    "marvel",
    "dc comics",
    "minecraft",
    "gta",
    "call of duty",
    "deadpool",
    "sex",
    "våld",
    "blod",
    "skräck",
    "demon",
    "ouija",
    "mörka andar",
    "självmord",
    "döda kroppar",
    "mord"
  ];

  // ------------------------------------------------------------
  // Mjukare variant av sanitering:
  // Tar bort förbjudna ord men behåller användarens struktur.
  // ------------------------------------------------------------
  function sanitizePrompt(input = "") {
    let txt = String(input || "").toLowerCase();

    for (const word of BLOCKED) {
      if (txt.includes(word)) {
        txt = txt.replace(new RegExp(word, "gi"), "(otillåtet innehåll borttaget)");
      }
    }

    return txt;
  }

  // ------------------------------------------------------------
  // PUBLIC API-metod
  // ------------------------------------------------------------
  global.generateStoryWithIPFilter = async function (prompt, opts = {}) {
    try {
      const cleanPrompt = sanitizePrompt(prompt || "");

      const body = {
        prompt: cleanPrompt,
        heroName: opts?.worldState?.meta?.hero || "",
        ageGroup: opts?.worldState?.meta?.ageValue || opts?.worldState?.meta?.age || "",
        lengthPreset: opts?.worldState?.meta?.lengthValue || "medium",
        storyMode: opts?.worldState?.story_mode || "chapter_book",
        chapterIndex: opts?.chapterIndex || 1,
        worldState: opts?.worldState || {},
        totalChapters: opts?.worldState?.meta?.totalChapters || 8
      };

      const res = await fetch(opts.apiUrl || "/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        return {
          ok: false,
          error: "Nätverks- eller API-fel",
          status: res.status
        };
      }

      const data = await res.json().catch(() => ({}));
      if (!data.ok) {
        return {
          ok: false,
          error: data.error || "Okänt fel",
          details: data.details || ""
        };
      }

      return { ok: true, text: data.story || "" };
    } catch (err) {
      console.error("[IP GC] Misslyckades:", err);
      return {
        ok: false,
        error: "Ett tekniskt fel uppstod.",
        details: String(err)
      };
    }
  };

  log("generateStory.ip.gc.js (GC v6.0) laddad");
})(window);
