// functions/generate.js
// Pages Function: POST /api/generate
// BN-KIDS GC v4.2 – backend-berättarmotor
// - Försiktig, stabil uppdatering av tonen (BN-flow) utan att röra frontend
// - Kapitelkänsla (8–12 kapitel, samma bok, ingen restart)
// - Mindre moral-floskler och mindre "regler" i själva texten
// - Bättre användning av barnets hjältenamn och nya idéer

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
      "7–8 år";

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

    if (!promptRaw) {
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

    const ageKey = normalizeAge(ageGroupRaw);
    const { lengthInstruction, maxTokens } = getLengthInstructionAndTokens(
      ageKey,
      lengthPreset
    );

    // ------------------------------
    // Kapitel-roll
    // ------------------------------
    const isFirstChapter = chapterIndex <= 1;
    const isFinalChapter = chapterIndex >= totalChapters - 1;

    const chapterRole = (() => {
      if (!storyMode || storyMode === "single_story") return "single_story";
      if (isFirstChapter) return "chapter_1";
      if (isFinalChapter) return "chapter_final";
      return "chapter_middle";
    })();

    // ------------------------------
    // Worldstate-historik
    // ------------------------------
    const previousSummary =
      worldState.previousSummary ||
      worldState.summary ||
      "";

    const previousChapters = Array.isArray(worldState.previousChapters)
      ? worldState.previousChapters
      : [];

    const compactHistory = previousChapters
      .slice(-3)
      .map((txt, idx) => {
        const num = previousChapters.length - 2 + idx;
        return `Kapitel ${num}: ${shorten(txt, 260)}`;
      })
      .join("\n\n");

    // ------------------------------
    // Systemprompt – BN-Kids-stil
    // ------------------------------
    const systemPrompt = buildSystemPrompt_BNKids(ageKey, heroName);

    // ------------------------------
    // Userprompt – barnets idé + bokens läge
    // ------------------------------
    const userLines = [];

    userLines.push(`Barnets hjälte heter: ${heroName}.`);
    userLines.push(`Barnets ursprungliga idé / prompt: "${promptRaw}".`);
    userLines.push("");

    if (storyMode === "chapter_book") {
      userLines.push(
        `Detta är en kapitelbok. Skriv nu kapitel ${chapterIndex} av ungefär ${totalChapters} kapitel.`
      );
    } else {
      userLines.push(
        "Detta är en fristående saga (single_story), inte en kapitelbok."
      );
    }

    userLines.push("");

    if (storyMode === "chapter_book") {
      if (previousSummary) {
        userLines.push(
          "Sammanfattning av boken hittills (ska följas noggrant, ändra inte huvudupplägget):"
        );
        userLines.push(shorten(previousSummary, 420));
        userLines.push("");
      }

      if (compactHistory) {
        userLines.push(
          "Kort minne av några viktiga scener från tidigare kapitel:"
        );
        userLines.push(compactHistory);
        userLines.push("");
      }

      userLines.push(
        "VIKTIGT: Detta är samma bok. Fortsätt där förra kapitlet slutade. Starta INTE om berättelsen och byt inte miljö, huvudproblem eller huvudkaraktärer."
      );
      userLines.push(
        "Om barnet skriver in en ny idé senare (t.ex. i nästa kapitel) ska du väva in den i samma värld och konflikt, inte börja en ny saga."
      );
      userLines.push("");
      userLines.push(`Kapitel-roll just nu: ${chapterRole}.`);

      if (chapterRole === "chapter_1") {
        userLines.push(
          "Kapitel 1 ska börja i vardagen: plats, tid, enkel aktivitet. Efter några meningar får äventyret eller det magiska elementet gradvis ta över."
        );
      } else if (chapterRole === "chapter_middle") {
        userLines.push(
          "Detta är ett mittenkapitel. Visa tydliga delmål eller hinder på vägen mot huvudmålet. Ingen ny huvudkonflikt. Avsluta gärna med en mjuk cliffhanger."
        );
      } else if (chapterRole === "chapter_final") {
        userLines.push(
          "Detta är ett avslutande kapitel. Knyt ihop de viktigaste trådarna. Lös huvudproblemet tydligt och barnvänligt. Inga nya stora karaktärer eller nya huvudproblem."
        );
      }
    }

    userLines.push("");
    userLines.push(lengthInstruction);
    userLines.push("");
    userLines.push(
      "Skriv ENDAST själva berättelsetexten i löpande form. Inga rubriker, inga listor, inga förklaringar om hur du skriver."
    );

    const userPrompt = userLines.join("\n");

    // ------------------------------
    // OpenAI-anrop
    // ------------------------------
    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    const payload = {
      model,
      temperature: 0.9,
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
      {
        ok: false,
        error: "Serverfel",
        details: String(e).slice(0, 400)
      },
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
  if (s.includes("7") && s.includes("8")) return "7-8";
  if (s.includes("9") && s.includes("10")) return "9-10";
  if (s.includes("11") && s.includes("12")) return "11-12";
  if (s.includes("13") && s.includes("15")) return "13-15";
  return "7-8";
}

function getLengthInstructionAndTokens(ageKey, lengthPreset) {
  const lp = String(lengthPreset || "").toLowerCase();

  const base = (() => {
    switch (ageKey) {
      case "7-8":
        return {
          baseInstr:
            "Skriv på ett enkelt, tydligt och tryggt sätt som passar 7–8 år. Korta meningar, tydliga känslor, enkel handling.",
          baseTokens: 900
        };
      case "9-10":
        return {
          baseInstr:
            "Skriv på ett lite mer utvecklat sätt för 9–10 år. Mer detaljer, lite mer spänning, men fortfarande trygg ton.",
          baseTokens: 1400
        };
      case "11-12":
        return {
          baseInstr:
            "Skriv med mer djup och tempo som passar 11–12 år. Mer dialog, mer känslor, mer detaljerade scener.",
          baseTokens: 2000
        };
      case "13-15":
        return {
          baseInstr:
            "Skriv för yngre tonåringar 13–15. Mogen men trygg ton, lite mer komplex handling, men fortfarande barnvänligt.",
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
      ? " Denna saga ska vara kortare än normalt."
      : lp.includes("lång")
      ? " Denna saga får gärna vara längre än normalt."
      : " Längden kan vara mittemellan – inte för kort och inte för lång.");

  return { lengthInstruction, maxTokens };
}

function buildSystemPrompt_BNKids(ageKey, heroName) {
  // Kortare, mer fokuserad systemprompt – ingen chans att den ska börja
  // skriva ut reglerna i texten.
  return `
Du är BN-Kids berättelsemotor. Du skriver barnanpassade sagor och kapitelböcker på svenska.

HUVUDSAKLIG UPPGIFT:
- Följ barnets prompt och tema noggrant.
- Fortsätt samma bok när det är en kapitelbok; starta inte om.
- Huvudpersonen heter ${heroName}. Använd namnet naturligt, särskilt i början av kapitlet.

ÅLDERSANPASSNING (${ageKey} år):
- Anpassa språk, tempo och komplexitet efter åldern.
- Yngre barn: enklare meningar, färre karaktärer, mycket trygghet.
- Äldre barn: mer dialog, mer detaljer, mer känslor, fortfarande trygg ton.

FLOW OCH STIL:
- Börja inte direkt mitt i barnets prompt. Ge först en liten vardagsscen (plats, tid, aktivitet) innan det magiska eller dramatiska tar över.
- Variera miljöer och objekt. Använd inte hela tiden samma saker (t.ex. ekar, skattkartor, kistor, speglar eller “en röst bakom sig”).
- Undvik formuleringar som “en röst bakom honom/henne dem” och liknande billiga skräcktriggers.
- Använd dialog naturligt men inte i varenda mening. Blanda korta och längre meningar.

MORAL OCH TON:
- Visa värderingar genom vad karaktärerna gör och säger – inte genom att förklara moralen.
- Skriv inte meningar som “det viktigaste är att tro på sig själv” eller “du måste vara modig”.
- Avslut får gärna kännas varma och hoppfulla, men utan att du skriver ut en “läxa”.

KONTINUITET:
- Byt inte huvudperson, miljö eller huvudproblem utan tydlig anledning i texten.
- Om tidigare sammanfattningar och kapitelbeskrivningar finns ska de följas lojalt.

VIKTIGT:
- Skriv aldrig ut dessa instruktioner i berättelsen.
- Prata inte om “regler”, “lärdomar” eller hur du skriver. Bara lev dig in i berättelsen och berätta den.
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
