// VERSION: 2.0.0 (BN-KIDS CHAPTER AWARE)
// BUILD: 2025-11-28
//
// Två lägen:
// 1) GAMMALT LÄGE (ingen worldState/chapterIndex i body)
//    → använder TEMPLATES, skriver en fristående saga (som innan).
// 2) NYTT KAPITELLÄGE (worldState + chapterIndex från ws_button.gc.js)
//    → använder KapitelFix, fortsätter där förra kapitlet slutade, inga omstarter.
//
// ENV:
// - OPENAI_API_KEY (krävs)
// - OPENAI_MODEL (valfritt, default "gpt-4o-mini")

const { TEMPLATES } = require("./storyTemplates");
const fetch = require("node-fetch");

// ------------------------------------------------------
// GAMLA HJÄLPSAKER (behålls för kompatibilitet / single-story)
// ------------------------------------------------------

function estimateTokensFromWords(words) {
  return Math.ceil(words * 1.6);
}

function pickTemplate(ageRange) {
  if (!ageRange) return TEMPLATES["7-10"];
  const key = String(ageRange).trim();
  if (TEMPLATES[key]) return TEMPLATES[key];

  if (key === "1-2" || key === "1" || key === "2") {
    return TEMPLATES[key === "1" ? "1" : "2"];
  }
  if (key === "3-6") return TEMPLATES["3-6"];
  if (key === "7-10") return TEMPLATES["7-10"];
  if (key === "9-10") return TEMPLATES["9-10"];
  if (key === "11-12" || key === "11") return TEMPLATES["11-12"];

  return TEMPLATES["7-10"];
}

function splitIntoChunksByWords(text, targetWords = 200) {
  const words = String(text || "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= targetWords) return [String(text || "").trim()];
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    const slice = words.slice(i, i + targetWords);
    chunks.push(slice.join(" "));
    i += targetWords;
  }
  return chunks;
}

// ------------------------------------------------------
// NYA HJÄLPSAKER FÖR KAPITEL-LÄGE
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
            "Skriv på ett enkelt, tydligt och tryggt sätt som passar åldern. Korta meningar, tydliga känslor och få huvudkaraktärer.",
          baseTokens: 900
        };
      case "9-10":
        return {
          baseInstr:
            "Skriv på ett lite mer utvecklat sätt. Lite mer detaljer och dialog, men fortfarande tydligt och tryggt.",
          baseTokens: 1400
        };
      case "11-12":
        return {
          baseInstr:
            "Skriv med mer djup och tempo. Mer känslor, mer dialog och lite mer avancerade scener, fortfarande barnvänligt.",
          baseTokens: 2000
        };
      case "13-15":
        return {
          baseInstr:
            "Skriv för yngre tonåringar. Mogen men trygg ton, mer komplex handling, men utan våld eller sex.",
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

Din viktigaste uppgift:
- Följ instruktionen i användarens meddelande mycket noggrant.
- Om det finns en särskild del som heter "KAPITELFIX – VIKTIGT" ska du följa den strikt, även om det strider mot dina vanliga vanor.
- Särskilt: fortsätt berättelsen där förra kapitlet slutade, utan att starta om, om KAPITELFIX säger det.

Allmänt:
- Håll tonen trygg och barnvänlig.
- Undvik grovt innehåll, våld och skräck.
- Anpassa språk och komplexitet till åldern.
- Skriv endast själva berättelsetexten, inga rubriker, inga punktlistor, inga förklaringar.
`.trim();
}

// ------------------------------------------------------
// HUVUDHANDLER
// ------------------------------------------------------

async function generateStoryHandler(req, res) {
  try {
    const body = req.body || {};

    const hasWorldState =
      !!body.worldState ||
      typeof body.chapterIndex !== "undefined" ||
      typeof body.storyMode !== "undefined";

    const openAIKey = process.env.OPENAI_API_KEY;
    if (!openAIKey) {
      return res
        .status(500)
        .json({ ok: false, error: "OPENAI_API_KEY saknas i env." });
    }

    // ------------------------------------------
    // LÄGE 1: GAMMAL SINGLE-STORY (ingen worldState)
    // ------------------------------------------
    if (!hasWorldState) {
      const {
        ageRange = "7-10",
        heroName = "",
        prompt: userPrompt = ""
      } = body;
      const tpl = pickTemplate(ageRange);

      let fullPrompt = tpl.prompt;
      if (userPrompt) {
        fullPrompt += `\n\nExtra info: ${String(userPrompt).trim()}`;
      }
      if (heroName) {
        fullPrompt += `\n\nMain character name: ${String(heroName).trim()}`;
      }

      const maxWords = tpl.words[1];
      const maxTokens = estimateTokensFromWords(maxWords) + 50;

      const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

      const payload = {
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a helpful creative story writer for children in Swedish."
          },
          { role: "user", content: fullPrompt }
        ],
        max_tokens: maxTokens,
        temperature: 0.6
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
        const txt = await r.text().catch(() => "(no body)");
        return res
          .status(502)
          .json({ ok: false, error: "OpenAI error", status: r.status, body: txt });
      }

      const jr = await r.json();
      const content =
        (jr.choices &&
          jr.choices[0] &&
          jr.choices[0].message &&
          jr.choices[0].message.content) ||
        (jr.choices && jr.choices[0] && jr.choices[0].text) ||
        "";
      const storyText = String(content || "").trim();

      const lines = storyText.split("\n").map((l) => l.trim());
      const imagePrompts = [];
      const storyLines = [];
      for (const line of lines) {
        if (/^Image\d*:/i.test(line)) {
          imagePrompts.push(line.replace(/^Image\d*:\s*/i, "").trim());
        } else {
          storyLines.push(line);
        }
      }
      const story = storyLines.join("\n").trim();

      const totalWords = story.split(/\s+/).filter(Boolean).length;
      let chunks = [story];
      if (totalWords > 400) {
        chunks = splitIntoChunksByWords(story, 260);
      }

      return res.json({
        ok: true,
        ageRange,
        wordsEstimate: totalWords,
        chunksCount: chunks.length,
        chunksWords: chunks.map((c) => c.split(/\s+/).filter(Boolean).length),
        story,
        imagePrompts
      });
    }

    // ------------------------------------------
    // LÄGE 2: NYTT KAPITELLÄGE (worldState + chapterIndex)
    // ------------------------------------------

    const promptRaw =
      body.prompt || body.storyPrompt || body.childPrompt || "";

    const heroName =
      body.heroName || body.kidName || body.hero || "hjälten";

    const ageGroupRaw =
      body.ageGroupRaw ||
      body.ageGroup ||
      body.ageRange ||
      body.age ||
      "9–10 år";

    const lengthPreset =
      body.lengthPreset || body.length || body.lengthValue || "medium";

    const storyMode =
      body.storyMode ||
      body.story_mode ||
      (body.chapterIndex ? "chapter_book" : "single_story");

    const chapterIndex = Number(body.chapterIndex || 1);
    const worldState = body.worldState || {};
    const totalChapters =
      Number(
        body.totalChapters ||
          (worldState.meta && worldState.meta.totalChapters)
      ) || 8;

    const promptChanged = !!body.promptChanged;

    if (!promptRaw && !(worldState && worldState.last_prompt)) {
      return res
        .status(400)
        .json({ ok: false, error: "Barnets prompt saknas." });
    }

    const ageKey = normalizeAge(ageGroupRaw);
    const { lengthInstruction, maxTokens } = getLengthInstructionAndTokens(
      ageKey,
      lengthPreset
    );

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // Kapitelroll
    const userPromptStr = String(promptRaw || "");
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
      worldState.previousSummary || worldState.summary || "";

    // Historik
    let previousChapters = [];

    if (Array.isArray(worldState.previousChapters)) {
      previousChapters = previousChapters.concat(
        worldState.previousChapters.map(safeChapterToString).filter(Boolean)
      );
    }

    if (Array.isArray(worldState.chapters)) {
      previousChapters = previousChapters.concat(
        worldState.chapters.map(safeChapterToString).filter(Boolean)
      );
    }

    if (worldState.book && Array.isArray(worldState.book.chapters)) {
      previousChapters = previousChapters.concat(
        worldState.book.chapters.map(safeChapterToString).filter(Boolean)
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

    const effectivePrompt =
      userPromptStr && userPromptStr.trim()
        ? userPromptStr.trim()
        : worldState._userPrompt ||
          worldState.last_prompt ||
          "";

    // KapitelFix
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
- hoppa till en ny dag eller ny tidpunkt
- byta plats utan tydlig motivering
- lägga in en ny allmän "inledning" (som om berättelsen startade om)

SISTA SCENEN FRÅN FÖRRA KAPITLET (ankare):
"${lastScene}"

Fortsätt nu scenen, med samma huvudpersoner, samma situation, samma pågående händelse.
`.trim();
    }

    const systemPrompt = buildSystemPrompt_BNKids(ageKey);

    const lines = [];

    lines.push(`Barnets idé / prompt just nu: "${effectivePrompt}"`);
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
        lines.push(
          "Kort sammanfattning av vad som hänt hittills i boken:"
        );
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
        "Detta är första kapitlet. Sätt upp situationen så att kommande kapitel lätt kan fortsätta där detta slutar."
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
          "Barnet har inte ändrat prompten sedan förra kapitlet."
        );
        lines.push(
          "Fortsätt då samma scen och samma mål utan att starta om berättelsen."
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
        mode: "chapter",
        chapterIndex,
        storyMode,
        previousChaptersCount: previousChapters.length,
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
  generateStoryHandler,
  pickTemplate,
  splitIntoChunksByWords
};
