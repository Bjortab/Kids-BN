// VERSION: 2.1.0 (BN-KIDS CHAPTER ENGINE, FÖRENKLAD)
// BUILD: 2025-11-28
//
// En enda väg in:
// - Tar alltid emot worldState/chapterIndex om det finns.
// - Om worldState saknas funkar det ändå (skriver som fristående saga),
//   men logiken är fortfarande "kapitel-medveten".
//
// Response innehåller alltid:
// {
//   ok: true/false,
//   story: "...",
//   debug: { ... }
// }
//
// ENV:
// - OPENAI_API_KEY (krävs)
// - OPENAI_MODEL (valfritt, default "gpt-4o-mini")

const { TEMPLATES } = require("./storyTemplates"); // finns kvar för bakåtkompat, används knappt
const fetch = require("node-fetch");

// ------------------------------------------------------
// Hjälpfunktioner
// ------------------------------------------------------

function normalizeAge(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.includes("7") && s.includes("8")) return "7-8";
  if (s.includes("9") && s.includes("10")) return "9-10";
  if (s.includes("11") && s.includes("12")) return "11-12";
  if (s.includes("13") || s.includes("14") || s.includes("15")) return "13-15";
  return "9-10";
}

function getLengthInstructionAndTokens(ageKey, lengthPreset) {
  const lp = String(lengthPreset || "").toLowerCase();

  const base = (() => {
    switch (ageKey) {
      case "7-8":
        return {
          baseInstr:
            "Skriv på ett enkelt, tydligt och tryggt sätt som passar 7–8 år. Korta meningar, tydliga känslor, få huvudkaraktärer.",
          baseTokens: 900
        };
      case "9-10":
        return {
          baseInstr:
            "Skriv på ett lite mer utvecklat sätt som passar 9–10 år. Lite mer detaljer och dialog, men fortfarande tydligt och tryggt.",
          baseTokens: 1400
        };
      case "11-12":
        return {
          baseInstr:
            "Skriv med mer djup och tempo som passar 11–12 år. Mer dialog, mer känslor, men fortfarande barnvänligt.",
          baseTokens: 2000
        };
      case "13-15":
        return {
          baseInstr:
            "Skriv för yngre tonåringar 13–15. Mogen men trygg ton, mer komplex handling, utan våld eller sex.",
          baseTokens: 2500
        };
      default:
        return {
          baseInstr:
            "Skriv en saga anpassad för barn. Tydligt, tryggt och åldersanpassat.",
          baseTokens: 1600
        };
    }
  })();

  let factor = 1.0;
  if (lp.includes("kort")) factor = 0.7;
  else if (lp.includes("lång")) factor = 1.3;

  const maxTokens = Math.round(base.baseTokens * factor);

  const lengthInstruction =
    base.baseInstr +
    (lp.includes("kort")
      ? " Denna saga/kapitel ska vara kortare än normalt."
      : lp.includes("lång")
      ? " Detta kapitel får gärna vara längre än normalt."
      : " Längden kan vara mittemellan – inte för kort, inte för lång.");

  return { lengthInstruction, maxTokens };
}

function safeChapterToString(chapter) {
  if (!chapter) return "";
  if (typeof chapter === "string") return chapter;
  if (typeof chapter === "object") {
    if (typeof chapter.text === "string") return chapter.text;
    if (typeof chapter.chapterText === "string") return chapter.chapterText;
    if (typeof chapter.story === "string") return chapter.story;
    if (typeof chapter.content === "string") return chapter.content;
  }
  return "";
}

function shorten(text, maxLen) {
  const s = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

function buildSystemPrompt_BNKids(ageKey) {
  return `
Du är BN-Kids berättelsemotor. Du skriver barnanpassade sagor och kapitelböcker på svenska för åldersgruppen ${ageKey} år.

Viktigt:
- Följ instruktionerna i användarens meddelande mycket noggrant.
- Om det finns en del som heter "KAPITELFIX – VIKTIGT" ska du följa den strikt.
- Särskilt: om KAPITELFIX säger att du ska fortsätta där förra kapitlet slutade,
  får du INTE starta om berättelsen.

Allmänt:
- Håll tonen trygg och barnvänlig.
- Undvik grovt innehåll, våld, skräck och romantik.
- Anpassa språk och komplexitet till åldern.
- Svara endast med själva berättelsetexten i löpande text.
`.trim();
}

// ------------------------------------------------------
// HUVUDHANDLER
// ------------------------------------------------------

async function generateStoryHandler(req, res) {
  try {
    const body = req.body || {};

    const openAIKey = process.env.OPENAI_API_KEY;
    if (!openAIKey) {
      return res
        .status(500)
        .json({ ok: false, error: "OPENAI_API_KEY saknas i env." });
    }

    // --------- Plocka worldState / meta ---------

    const ws = body.worldState || {};
    const hasWorldState = !!body.worldState;

    const chapterIndex =
      Number(body.chapterIndex || ws.chapterIndex || 1) || 1;

    const storyMode =
      body.storyMode ||
      ws.story_mode ||
      (chapterIndex > 1 ? "chapter_book" : "single_story");

    const promptRaw =
      body.prompt ||
      body.storyPrompt ||
      body.childPrompt ||
      ws._userPrompt ||
      ws.last_prompt ||
      "";

    if (!promptRaw) {
      return res
        .status(400)
        .json({ ok: false, error: "Barnets prompt saknas." });
    }

    const heroName =
      body.heroName ||
      body.kidName ||
      body.hero ||
      (ws.meta && ws.meta.hero) ||
      "hjälten";

    const ageGroupRaw =
      body.ageGroupRaw ||
      body.ageGroup ||
      body.ageRange ||
      body.age ||
      (ws.meta && ws.meta.age) ||
      "9–10 år";

    const lengthPreset =
      body.lengthPreset ||
      body.length ||
      body.lengthValue ||
      (ws.meta && (ws.meta.lengthValue || ws.meta.length)) ||
      "medium";

    const totalChapters =
      Number(
        body.totalChapters ||
          (ws.meta && ws.meta.totalChapters) ||
          8
      ) || 8;

    const promptChanged =
      typeof body.promptChanged === "boolean"
        ? body.promptChanged
        : false;

    const ageKey = normalizeAge(ageGroupRaw);
    const { lengthInstruction, maxTokens } = getLengthInstructionAndTokens(
      ageKey,
      lengthPreset
    );

    // --------- Kapitelroll & historik ---------

    const userPromptStr = String(promptRaw || "").trim();
    const userWantsEnd = /avslut|knyt ihop|slut(et)?/i.test(userPromptStr);

    let chapterRole;
    if (!storyMode || storyMode === "single_story") {
      chapterRole = "single_story";
    } else if (chapterIndex <= 1) {
      chapterRole = "chapter_1";
    } else if (userWantsEnd || chapterIndex >= totalChapters) {
      chapterRole = "chapter_final";
    } else {
      chapterRole = "chapter_middle";
    }

    const previousSummary =
      ws.previousSummary || ws.summary || "";

    let previousChapters = [];

    if (Array.isArray(ws.previousChapters)) {
      previousChapters = previousChapters.concat(
        ws.previousChapters.map(safeChapterToString).filter(Boolean)
      );
    }
    if (Array.isArray(ws.chapters)) {
      previousChapters = previousChapters.concat(
        ws.chapters.map(safeChapterToString).filter(Boolean)
      );
    }
    if (ws.book && Array.isArray(ws.book.chapters)) {
      previousChapters = previousChapters.concat(
        ws.book.chapters.map(safeChapterToString).filter(Boolean)
      );
    }
    if (Array.isArray(body.previousChapters)) {
      previousChapters = previousChapters.concat(
        body.previousChapters.map(safeChapterToString).filter(Boolean)
      );
    }

    if (previousChapters.length > 1) {
      previousChapters = Array.from(new Set(previousChapters));
    }

    const compactHistory = previousChapters
      .map((txt, idx) => `Kapitel ${idx + 1}: ${shorten(txt, 320)}`)
      .slice(-3)
      .join("\n\n");

    const lastChapterText =
      previousChapters.length > 0
        ? String(previousChapters[previousChapters.length - 1] || "")
        : "";

    // --------- KapitelFix: ankra i sista scenen ---------

    let continuityInstruction = "";
    let lastScene = "";

    if (
      storyMode === "chapter_book" &&
      chapterIndex > 1 &&
      lastChapterText
    ) {
      lastScene = lastChapterText.slice(-450).trim();

      continuityInstruction = `
KAPITELFIX – VIKTIGT:

Du SKA fortsätta direkt från sista scenen i föregående kapitel.
Första meningen i detta kapitel ska kännas som NÄSTA RAD efter texten nedan.
Du får INTE:
- börja om sagan
- hoppa till en ny dag eller ny tidpunkt utan tydlig förklaring
- byta plats eller huvudproblem utan att det följer logiskt av vad som hänt

SISTA SCENEN FRÅN FÖRRA KAPITLET (ankare):
"${lastScene}"

Fortsätt nu scenen, med samma huvudpersoner, samma situation, samma pågående händelse.
`.trim();
    }

    const systemPrompt = buildSystemPrompt_BNKids(ageKey);

    // --------- Bygg userPrompt ---------

    const lines = [];

    lines.push(`Barnets idé / prompt just nu: "${userPromptStr}"`);
    lines.push("");
    lines.push(`Hjälte: ${heroName}`);
    lines.push(`Åldersband: ${ageKey} år`);
    lines.push(`Längdpreset: ${lengthPreset}`);
    lines.push(`Storyläge: ${storyMode}`);
    if (storyMode === "chapter_book") {
      lines.push(
        `Detta är kapitel ${chapterIndex} i en kapitelbok (totalt ca ${totalChapters} kapitel).`
      );
    } else {
      lines.push("Detta är en fristående saga (single_story).");
    }
    lines.push("");

    if (storyMode === "chapter_book") {
      if (previousSummary) {
        lines.push("Kort sammanfattning av vad som hänt hittills:");
        lines.push(shorten(previousSummary, 420));
        lines.push("");
      } else if (previousChapters.length) {
        lines.push(
          "Tidigare kapitel finns sparade. Här är några viktiga saker som hänt:"
        );
        lines.push(compactHistory || "- inga sparade kapitel ännu");
        lines.push("");
      } else {
        lines.push(
          "Detta verkar vara början på boken. Inga tidigare kapitel är sparade."
        );
        lines.push("");
      }
    }

    lines.push(`Kapitelroll just nu: ${chapterRole}.`);
    lines.push("");

    if (continuityInstruction) {
      lines.push(continuityInstruction);
      lines.push("");
    } else if (storyMode === "chapter_book" && chapterIndex === 1) {
      lines.push(
        "Detta är första kapitlet. Börja i vardagen (plats, tid, enkel aktivitet) och låt äventyret växa fram."
      );
      lines.push(
        "Avsluta kapitlet så att det är lätt att fortsätta direkt därifrån i nästa kapitel."
      );
      lines.push("");
    }

    if (storyMode === "chapter_book" && chapterIndex > 1) {
      if (promptChanged) {
        lines.push(
          "Barnet har ändrat eller lagt till en ny önskan för JUST DETTA KAPITEL."
        );
        lines.push(
          "Fortsätt samma pågående scen, men låt den nya önskan styra vad som händer nu."
        );
      } else {
        lines.push(
          "Barnet har inte ändrat prompten sedan förra kapitlet. Fortsätt då samma scen och samma mål utan att starta om berättelsen."
        );
      }
      lines.push("");
    }

    lines.push(lengthInstruction);
    lines.push("");
    lines.push(
      "VIKTIGT: Svara enbart med själva berättelsen i löpande text. Inga rubriker, inga punktlistor, inga 'Lärdomar:' och inga förklaringar om varför du skrev som du gjorde."
    );

    const userPrompt = lines.join("\n");

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const payload = {
      model,
      temperature: 0.35,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAIKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(502).json({
        ok: false,
        error: "OpenAI-fel",
        details: text.slice(0, 500)
      });
    }

    const data = await r.json();
    const story =
      (data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content &&
        String(data.choices[0].message.content).trim()) ||
      "";

    return res.json({
      ok: true,
      story,
      debug: {
        chapterIndex,
        storyMode,
        hasWorldState,
        ageKey,
        lengthPreset,
        totalChapters,
        previousChaptersCount: previousChapters.length,
        promptChanged,
        usedLastScene: Boolean(lastScene),
        lastScenePreview: lastScene ? shorten(lastScene, 120) : ""
      }
    });
  } catch (err) {
    console.error("generateStoryHandler error", err);
    return res.status(500).json({
      ok: false,
      error: "server error",
      message: String(err)
    });
  }
}

module.exports = {
  generateStoryHandler
};
