// functions/generate.js
// Pages Function: POST /api/generate
//
// BN-KIDS GC v11.0 – KapitelFix
// Fokus:
// - Stabil kapiteltråd i kapitelboksläge
// - Fortsätt direkt där förra kapitlet slutade (KapitelFix v11)
// - Minimal stilstyrning, modellen får vara "fri" så länge den följer flödet

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

    const storyMode =
      body.storyMode ||
      body.story_mode ||
      (body.chapterIndex ? "chapter_book" : "single_story");

    const chapterIndex = Number(body.chapterIndex || 1);
    const worldState = body.worldState || {};
    const totalChapters =
      Number(body.totalChapters || worldState?.meta?.totalChapters) || 8;

    const promptChanged = !!body.promptChanged;

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
    // Ålder + längd → instr + max_tokens
    // ------------------------------------------------------
    const ageKey = normalizeAge(ageGroupRaw);
    const { lengthInstruction, maxTokens } = getLengthInstructionAndTokens(
      ageKey,
      lengthPreset
    );

    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    // ------------------------------------------------------
    // Kapitelroll & historik
    // ------------------------------------------------------
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
      worldState.previousSummary ||
      worldState.summary ||
      "";

    const previousChapters = Array.isArray(worldState.previousChapters)
      ? worldState.previousChapters
      : [];

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
        : (worldState._userPrompt ||
           worldState.last_prompt ||
           "");

    // ------------------------------------------------------
    // KAPITELFIX v11 — hård låsning av kontinuitet
    // ------------------------------------------------------
    let continuityInstruction = "";
    if (
      storyMode === "chapter_book" &&
      chapterIndex > 1 &&
      lastChapterText
    ) {
      const lastScene = lastChapterText.slice(-450).trim();

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

    // ------------------------------------------------------
    // SYSTEMPROMPT – enkel, fokuserar på säkerhet + flöde
    // ------------------------------------------------------
    const systemPrompt = buildSystemPrompt_BNKids_v11(ageKey);

    // ------------------------------------------------------
    // USERPROMPT – barnets idé + worldstate + kapitelroll + KapitelFix
    // ------------------------------------------------------
    const lines = [];

    // Barnets idé
    lines.push(
      `Barnets idé / prompt just nu: "${effectivePrompt}"`
    );
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

    // Historik / sammanfattning (valfritt stöd, men inte det primära)
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

    // Kapitelroll (väldigt kort)
    lines.push(`Kapitelroll just nu: ${chapterRole}.`);
    lines.push("");

    // KapitelFix – den viktigaste delen för kapitel 2+
    if (continuityInstruction) {
      lines.push(continuityInstruction);
      lines.push("");
    } else if (storyMode === "chapter_book" && chapterIndex === 1) {
      // Liten hint för kapitel 1 (ingen hård regel)
      lines.push(
        "Detta är första kapitlet. Sätt upp situationen så att kommande kapitel lätt kan fortsätta där detta slutar."
      );
      lines.push("");
    }

    // promptChanged-info (för att styra scenen, men inte flödet)
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

    // Längdinstruktion
    lines.push(lengthInstruction);
    lines.push("");
    lines.push(
      "VIKTIGT: Svara enbart med själva berättelsen i löpande text. Inga rubriker, inga punktlistor, inga 'Lärdomar:' och inga förklaringar om varför du skrev som du gjorde."
    );

    const userPrompt = lines.join("\n");

    // ------------------------------------------------------
    // OpenAI-anrop
    // ------------------------------------------------------
    const payload = {
      model,
      temperature: 0.35, // LÅG TEMP för stabilt flöde mellan kapitel
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
        {
          ok: false,
          error: "OpenAI-fel",
          details: text.slice(0, 500)
        },
        502,
        origin
      );
    }

    const data = await res.json();
    const story =
      data.choices?.[0]?.message?.content?.trim() || "";

    return json({ ok: true, story }, 200, origin);
  } catch (e) {
    return json(
      { ok: false, error: "Serverfel", details: String(e).slice(0, 400) },
      500,
      origin
    );
  }
}

// ------------------------------------------------------
// Hjälpfunktioner
// ------------------------------------------------------

function normalizeAge(raw) {
  const s = String(raw || "").toLowerCase();
  // Matcha våra dropdown-värden: 7-8, 9-10, 11-12, 13-14, 15
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

// Minimal systemprompt: säkerhet + följ instruktionen (särskilt KapitelFix)
function buildSystemPrompt_BNKids_v11(ageKey) {
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
