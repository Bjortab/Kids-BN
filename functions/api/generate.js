// functions/api/generate.js
// BN-KIDS — Cloudflare Pages Function: POST /api/generate
//
// GC v7.3 – FLOSKEL CLEANUP
// ENDAST ändringar i buildSystemPrompt_BNKids_v7 (markerade)
// Absolut inga ändringar i kapitelmotor, historik, index, summary, eller flow.

export async function onRequestOptions({ env }) {
  const origin =
    env.KIDSBM_ALLOWED_ORIGIN ||
    env.KIDSBM_ALLOWED_ORIGIN_DEV ||
    env.KIDSBM_ALLOWED_ORIGIN_LOCAL ||
    env.KIDSBM_ALLOWED_ORIGIN_PREVIEW ||
    env.KIDSBM_ALLOWED_ORIGIN_PROD ||
    env.KIDSBM_ALLOWED_ORIGIN_KIDS ||
    env.KIDSBM_ALLOWED_ORIGIN_BN ||
    env.KIDSBM_ALLOWED_ORIGIN_KIDSBM ||
    "*";

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

export async function onRequestPost({ request, env }) {
  const origin =
    env.KIDSBM_ALLOWED_ORIGIN ||
    env.KIDSBM_ALLOWED_ORIGIN_DEV ||
    env.KIDSBM_ALLOWED_ORIGIN_LOCAL ||
    env.KIDSBM_ALLOWED_ORIGIN_PREVIEW ||
    env.KIDSBM_ALLOWED_ORIGIN_PROD ||
    env.KIDSBM_ALLOWED_ORIGIN_KIDS ||
    env.KIDSBM_ALLOWED_ORIGIN_BN ||
    env.KIDSBM_ALLOWED_ORIGIN_KIDSBM ||
    "*";

  try {
    const body = await request.json().catch(() => ({}));

    // ------------------------------------------------------
    // Grunddata
    // ------------------------------------------------------
    const promptRaw =
      body.prompt ||
      body.storyPrompt ||
      body.childPrompt ||
      "";

    const heroName =
      body.heroName ||
      body.kidName ||
      body.hero ||
      "hjälten";

    const ageGroupRaw =
      body.ageGroupRaw ||
      body.ageGroup ||
      body.ageRange ||
      body.age ||
      "9–10 år";

    const lengthPreset =
      body.lengthPreset ||
      body.length ||
      body.lengthValue ||
      "medium";

    let storyMode =
      body.storyMode ||
      body.story_mode ||
      (body.chapterIndex ? "chapter_book" : "single_story");

    const worldState = body.worldState || {};
    const promptChanged = !!body.promptChanged;

    const previousChapters = Array.isArray(worldState.previousChapters)
      ? worldState.previousChapters
      : [];

    const previousChaptersCount = previousChapters.length;

    const totalChapters =
      Number(body.totalChapters || worldState?.meta?.totalChapters) || 8;

    // ------------------------------------------------------
    // KapitelIndex (ORÖRT)
    // ------------------------------------------------------
    let chapterIndexFromBody = Number(body.chapterIndex || 0);
    let chapterIndex;

    if (previousChaptersCount > 0) {
      chapterIndex = previousChaptersCount + 1;
    } else if (chapterIndexFromBody > 0) {
      chapterIndex = chapterIndexFromBody;
    } else {
      chapterIndex = 1;
    }

    if (!storyMode || storyMode === "single_story") {
      storyMode = chapterIndex > 1 ? "chapter_book" : "single_story";
    }

    if (!promptRaw && !worldState?.last_prompt) {
      return json(
        { ok: false, error: "Barnets prompt saknas." },
        400,
        origin
      );
    }

    if (!env.OPENAI_API_KEY) {
      return json(
        { ok: false, error: "OPENAI_API_KEY saknas i env." },
        500,
        origin
      );
    }

    // ------------------------------------------------------
    // Språk + längd
    // ------------------------------------------------------
    const ageKey = normalizeAge(ageGroupRaw);
    const { lengthInstruction, maxTokens } = getLengthInstructionAndTokens(
      ageKey,
      lengthPreset
    );

    // ------------------------------------------------------
    // KapitelRoll (ORÖRT)
    // ------------------------------------------------------
    const userWantsEnd = /avslut|knyt ihop|slut(et)?/i.test(promptRaw || "");

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

    // ------------------------------------------------------
    // Historik (ORÖRT)
    // ------------------------------------------------------
    const previousSummary =
      worldState.previousSummary ||
      worldState.summary ||
      "";

    const compactHistory = previousChapters
      .map((txt, idx) => `Kapitel ${idx + 1}: ${shorten(txt, 320)}`)
      .slice(-3)
      .join("\n\n");

    const lastChapterText =
      previousChaptersCount > 0
        ? String(previousChapters[previousChaptersCount - 1] || "")
        : "";

    const lastScenePreview = lastChapterText
      ? shorten(lastChapterText.slice(-600), 320)
      : "";

    const effectivePrompt =
      promptRaw && String(promptRaw).trim()
        ? String(promptRaw).trim()
        : (worldState._userPrompt ||
           worldState.last_prompt ||
           "");

    // ------------------------------------------------------
    // SYSTEMPROMPT (ENDA stället jag ändrat)
    // ------------------------------------------------------
    const systemPrompt = buildSystemPrompt_BNKids_v7(ageKey);

    // ------------------------------------------------------
    // USERPROMPT (ORÖRT)
    // ------------------------------------------------------
    const lines = [];

    lines.push(`Barnets idé / prompt just nu: "${effectivePrompt}"`);
    lines.push("");
    lines.push(`Hjälte: ${heroName}`);
    lines.push(`Åldersband: ${ageKey} år`);
    lines.push(`Längdpreset: ${lengthPreset}`);
    lines.push(`Storyläge: ${storyMode}`);
    if (storyMode === "chapter_book") {
      lines.push(`Detta är kapitel ${chapterIndex} i en kapitelbok (totalt ca ${totalChapters} kapitel).`);
    } else {
      lines.push("Detta är en fristående saga (single_story).");
    }
    lines.push("");

    if (storyMode === "chapter_book") {
      if (previousSummary) {
        lines.push("Kort sammanfattning av vad som hänt hittills i boken:");
        lines.push(shorten(previousSummary, 420));
        lines.push("");
      } else if (previousChaptersCount > 0) {
        lines.push("Tidigare kapitel finns, men ingen separat sammanfattning är sparad. Här är några viktiga saker som hänt:");
        lines.push(compactHistory || "- inga sparade kapitel ännu");
        lines.push("");
      } else {
        lines.push("Detta verkar vara början på boken. Inga tidigare kapitel är sparade.");
        lines.push("");
      }
    }

    if (storyMode === "chapter_book" && previousChaptersCount > 0 && lastScenePreview) {
      lines.push("Här är slutet av förra kapitlet (den scen du ska fortsätta direkt efter):");
      lines.push(lastScenePreview);
      lines.push("");
    }

    lines.push(`Kapitelroll just nu: ${chapterRole}.`);

    // ------------------------------------------------------
    // Rollinstruktioner (ORÖRT)
    // ------------------------------------------------------
    if (chapterRole === "chapter_1") {
      lines.push("Kapitel 1 ska börja i vardagen: plats, tid och enkel aktivitet innan något märkligt händer.");
      lines.push("Barnets idé ska vävas in gradvis – inte allt på första meningen.");
    } else if (chapterRole === "chapter_middle") {
      lines.push("Fortsätt precis där förra kapitlet slutade. Upprepa inte startsituationen.");
      lines.push("Fördjupa huvudmålet och introducera ett hinder eller delmål.");
    } else if (chapterRole === "chapter_final") {
      lines.push("Knyt ihop handlingen. Inga helt nya stora karaktärer eller platser.");
      lines.push("Ge ett tydligt, varmt och sammanhängande slut – utan moralpredikningar.");
    }

    lines.push("");

    if (storyMode === "chapter_book" && chapterIndex > 1) {
      if (promptChanged) {
        lines.push("Barnet har just ändrat sin önskan för detta kapitel – väv in den i den pågående berättelsen utan att börja om.");
      } else {
        lines.push("Barnet har inte ändrat sin prompt – fortsätt exakt där förra kapitlet slutade utan att starta om.");
      }
      lines.push("");
    }

    lines.push(lengthInstruction);
    lines.push("");
    lines.push("VIKTIGT: Svara enbart med berättelsen. Inga rubriker, inga listor, inga förklaringar.");

    const userPrompt = lines.join("\n");

    // ------------------------------------------------------
    // OpenAI-anrop (ORÖRT)
    // ------------------------------------------------------
    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    const payload = {
      model,
      temperature: 0.7,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    };

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return json(
        { ok: false, error: "OpenAI-fel", details: text.slice(0, 500) },
        502,
        origin
      );
    }

    const data = await res.json();
    const story = data.choices?.[0]?.message?.content?.trim() || "";

    return json(
      {
        ok: true,
        story,
        debug: {
          chapterIndex,
          storyMode,
          ageKey,
          lengthPreset,
          totalChapters,
          previousChaptersCount,
          promptChanged,
          usedLastScene: !!lastScenePreview,
          lastScenePreview
        }
      },
      200,
      origin
    );

  } catch (e) {
    return json(
      { ok: false, error: "Serverfel", details: String(e).slice(0, 400) },
      500,
      origin
    );
  }
}

// ------------------------------------------------------
// Hjälpfunktioner (ORÖRT)
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
            "Skriv enkelt och tydligt för 7–8 år. Få karaktärer, korta meningar, tydliga känslor.",
          baseTokens: 900
        };
      case "9-10":
        return {
          baseInstr:
            "Skriv med fler detaljer och lite mer fart för 9–10 år, men håll det tryggt.",
          baseTokens: 1400
        };
      case "11-12":
        return {
          baseInstr:
            "Skriv med mer djup och tempo för 11–12 år. Mer dialog och känslor.",
          baseTokens: 2000
        };
      case "13-15":
        return {
          baseInstr:
            "Skriv moget men barnvänligt för yngre tonåringar.",
          baseTokens: 2500
        };
      default:
        return {
          baseInstr: "Skriv en barnanpassad saga på tydlig svenska.",
          baseTokens: 1600
        };
    }
  })();

  let factor = 1.0;
  if (lp.includes("kort") || lp.includes("short")) factor = 0.7;
  else if (lp.includes("lång") || lp.includes("long")) factor = 1.3;

  const maxTokens = Math.round(base.baseTokens * factor);

  const lengthInstruction =
    base.baseInstr +
    (lp.includes("kort") || lp.includes("short")
      ? " Denna saga/kapitel ska vara kortare än normalt."
      : lp.includes("lång") || lp.includes("long")
      ? " Detta kapitel får gärna vara längre än normalt."
      : " Längden kan vara mittemellan – inte för kort, inte för lång.");

  return { lengthInstruction, maxTokens };
}

function buildSystemPrompt_BNKids_v7(ageKey) {
  return `
Du är BN-Kids berättelsemotor. Du skriver barnvänliga sagor och kapitel på tydlig svenska.

### FOKUS & GENRE
- Håll dig till barnets tema och prompt.
- Byt aldrig genre eller huvudmål utan orsak.
- Om barnet nämner ett viktigt objekt ska det följas upp konsekvent.
- Undvik skräck, mörker och hot om inte barnet uttryckligen ber om det.

### ÅLDERSBAND (${ageKey})
- Anpassa språk, tempo och komplexitet efter ålder.
- Undvik onödiga beskrivningar som bromsar handlingen.

### BN-FLOW LAYER
- Börja inte direkt med barnets prompt i första meningen.
- Starta i vardagen: plats, aktivitet, stämning.
- Variera miljöer och objekt. Använd inte samma träd, samma kista, samma konstiga skugga i varje saga.
- Undvik slitna uttryck som "solen glittrade", "hjärtat dansade", "det viktiga är att vara modig".
- Undvik moralfraser. Visa hellre genom handling.

### MORAL & TON
- Tonen ska vara varm men inte överdrivet söt.
- Undvik predikande meningar och generiska vänskapsfraser.

### KONTINUITET
- Håll handlingen sammanhängande. Inga omstarter.
- Håll koll på tidigare händelser och karaktärer.
- Upprepa inte samma scen utan orsak.

### UTDATA
- Endast berättelsetext. Inga rubriker eller listor.
`.trim(); // 🔵 FLOSKEL-EDIT ENDAST HÄR
}

function shorten(text, maxLen) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

function json(obj, status = 200, origin = "*") {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      "Access-Control-Allow-Origin": origin
    }
  });
}
