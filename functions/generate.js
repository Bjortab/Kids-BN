// functions/generate.js
// Pages Function: POST /api/generate
// BN-KIDS GC v6.4
//
// Fokus v6.4:
// - HÅRD "fortsätt där du slutade"-instruktion för kapitel 2+
// - Använder summary + sista kapitel-svansen som context
// - Förbjuder klassiska floskler ("hjärtat bultade", "hörde ett ljud bakom sig" osv)
// - Håller API-formatet: { ok: true, story }
//
// OBS: worldstate.gc.js v6.x och ws_button.gc.js v6.x ska vara laddade i frontend.

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

    // --- Inparametrar från ws_button.gc.js v6.x -----------------------
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
      Number(body.totalChapters || worldState?.meta?.totalChapters) || 9;

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

    // --- Ålder + längd-inställningar ---------------------------------
    const ageKey = normalizeAge(ageGroupRaw);
    const { lengthInstruction, maxTokens } = getLengthInstructionAndTokens(
      ageKey,
      lengthPreset
    );

    // --- Hämta tidigare context från worldState -----------------------
    const previousSummary =
      worldState.previousSummary ||
      worldState.summary ||
      "";

    const previousChapters = Array.isArray(worldState.previousChapters)
      ? worldState.previousChapters
      : [];

    const lastChapterText =
      previousChapters.length > 0
        ? previousChapters[previousChapters.length - 1]
        : "";

    const lastChapterTail = shorten(lastChapterText, 650);

    const isFirstChapter = chapterIndex <= 1;
    const isFinalChapter = chapterIndex >= (totalChapters || 9) - 1;

    const chapterRole = (() => {
      if (!storyMode || storyMode === "single_story") return "single_story";
      if (isFirstChapter) return "chapter_1";
      if (isFinalChapter) return "chapter_final";
      return "chapter_middle";
    })();

    // --- Systemprompt (stil + anti-floskler + kapitelregler) ----------
    const systemPrompt = buildSystemPrompt_BNKids(ageKey);

    // --- USER-prompt: barnets idé + hård fortsättnings-instruktion ----
    const lines = [];

    lines.push(`Barnets idé / prompt: "${promptRaw}"`);
    lines.push("");
    lines.push(`Hjälte: ${heroName}`);
    lines.push(`Åldersband: ${ageKey} år`);
    lines.push(`Längdspreset: ${String(lengthPreset || "medium")}`);
    lines.push(`Story-läge: ${storyMode}`);
    if (storyMode === "chapter_book") {
      lines.push(
        `Detta är kapitel ${chapterIndex} i en kapitelbok (totalt ca ${totalChapters} kapitel).`
      );
    } else {
      lines.push("Detta är en fristående saga (single_story).");
    }
    lines.push("");

    if (storyMode === "chapter_book") {
      lines.push(
        "Tidigare i boken (sammanfattning, om finns): " +
          (previousSummary
            ? shorten(previousSummary, 480)
            : "Detta är början – anta att inget större har hänt ännu.")
      );

      if (previousChapters.length > 1) {
        const compactHistory = previousChapters
          .slice(-3)
          .map((txt, idx, arr) => {
            const chapterNo =
              previousChapters.length - (arr.length - idx) + 1;
            return `Kapitel ${chapterNo}: ${shorten(txt, 260)}`;
          })
          .join("\n\n");
        lines.push("");
        lines.push("Några viktiga saker som redan hänt:");
        lines.push(compactHistory || "- inga sparade kapitel ännu");
      }

      if (!isFirstChapter && lastChapterTail) {
        lines.push("");
        lines.push(
          "Här är slutet av det föregående kapitlet. DU SKA FORTSÄTTA DIREKT EFTER DETTA, utan att börja om, utan att skriva samma scen igen, och utan att ändra relationer eller bakgrund:"
        );
        lines.push("");
        lines.push('--- SLUTET AV FÖREGÅENDE KAPITEL ---');
        lines.push(shorten(lastChapterTail, 650));
        lines.push('--- SLUT PÅ FÖREGÅENDE KAPITEL ---');
      }
    }

    lines.push("");
    lines.push(`Kapitelroll: ${chapterRole}.`);
    if (chapterRole === "chapter_1") {
      lines.push(
        "Kapitel 1 ska börja i vardagen: plats, tid, enkel aktivitet. Låt sedan barnets idé ta över och leda in mot äventyret. Sluta gärna med en mjuk krok som gör att man vill läsa vidare, men gör det tydligt att berättelsen precis har börjat."
      );
    } else if (chapterRole === "chapter_middle") {
      lines.push(
        "Detta är ett mittenkapitel. FORTSÄTT SAMMA HUVUDÄVENTYR. Ingen ny start, ingen ny magisk dörr, ingen ny skattkarta. Visa ett tydligt delmål, hinder eller ny pusselbit på vägen mot samma mål. Avsluta gärna med en mjuk cliffhanger, men utan att upprepa tidigare scener."
      );
    } else if (chapterRole === "chapter_final") {
      lines.push(
        "Detta är ett avslutande kapitel. Knyt ihop de viktigaste trådarna från tidigare kapitel. Lös huvudkonflikten tydligt och barnvänligt. Introducera inte helt nya huvudproblem eller viktiga nya personer här."
      );
    }

    lines.push("");
    lines.push(lengthInstruction);
    lines.push("");
    lines.push(
      "VIKTIGT: Skriv bara själva berättelsetexten i löpande prosa. Inga rubriker, inga listor, inga 'Lärdomar'."
    );

    const userPrompt = lines.join("\n");

    // --- OpenAI-anrop -----------------------------------------------
    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    const payload = {
      model,
      temperature: 0.7, // lite lägre för bättre följande av tråd
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

    const data = await res.json().catch(() => null);
    const story =
      data?.choices?.[0]?.message?.content?.trim() || "";

    if (!story) {
      return json(
        { ok: false, error: "Tomt svar från berättelsemotorn." },
        502,
        origin
      );
    }

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

// ======================================================================
// Hjälpfunktioner
// ======================================================================

function normalizeAge(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.includes("7") && s.includes("8")) return "7-8";
  if (s.includes("9") && s.includes("10")) return "9-10";
  if (s.includes("11") && s.includes("12")) return "11-12";
  if (s.includes("13") && s.includes("14")) return "13-14";
  if (s.includes("15")) return "15";
  return "9-10";
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
            "Skriv på ett lite mer utvecklat sätt för 9–10 år. Mer detaljer och dialog, men fortfarande tydligt och tryggt.",
          baseTokens: 1400
        };
      case "11-12":
        return {
          baseInstr:
            "Skriv med mer djup och tempo som passar 11–12 år. Mer känslor, mer detaljerade scener, ibland lite humor.",
          baseTokens: 2000
        };
      case "13-14":
      case "15":
        return {
          baseInstr:
            "Skriv för yngre tonåringar. Mogen men trygg ton, lite mer komplex handling, men fortfarande barnvänligt.",
          baseTokens: 2300
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
      ? " Denna text ska vara kortare än normalt."
      : lp.includes("lång")
      ? " Denna text får gärna vara längre än normalt."
      : " Längden kan vara mittemellan – inte för kort, inte för lång.");

  return { lengthInstruction, maxTokens };
}

function buildSystemPrompt_BNKids(ageKey) {
  return `
Du är BN-Kids berättelsemotor. Du skriver kapitelböcker och fristående sagor på svenska för barn.

### FOKUS & GENRE
- Följ alltid barnets prompt och huvudtema noggrant.
- Byt aldrig genre eller huvudproblem utan att barnet bett om det.
- Om barnet nämner ett viktigt objekt (t.ex. magisk dörr, hemlig hiss, drakland) ska det objektet fortsätta vara centralt tills konflikten är löst.
- Undvik mörker/skräck om inte barnet tydligt ber om det.

### ÅLDERSBAND (${ageKey})
- Anpassa språk, tempo och komplexitet efter åldern.
- Få huvudpersoner, tydliga mål, inga onödiga sidospår.

### STIL / FLOW
- Börja inte med en moral eller sammanfattning.
- Börja i vardagen: plats, tid, enkel aktivitet. Gå sedan in i det magiska / spännande.
- Variera miljöer och objekt. Använd inte alltid samma träd, skattkartor eller kistor.
- Använd dialog naturligt men inte i varje mening.
- Variera meningslängd: blanda korta och längre meningar.

### ANTI-FLOSKLER (VIKTIGT)
Undvik slitna standardfraser. Skriv mer konkret och unikt.
- Undvik formuleringar som:
  - "han kände hur hans hjärta bultade av glädje"
  - "hon hörde ett ljud bakom sig"
  - "det pirrade i magen på ett speciellt sätt"
  - "hon kände sig både nervös och förväntansfull på samma gång"
- Visa i stället känslor genom vad barnen gör, säger och tänker i situationen.

### MORAL & TON
- Visa värden genom handling, inte genom att skriva ut moralen rakt ut.
- Inga direkta predikningar i slutet ("det viktigaste är vänskap" etc.).
- Varma, hoppfulla slut är bra, men moralen ska ligga i berättelsen, inte i en egen mening.

### KAPITELBOKSLÄGE
När du skriver en kapitelbok:
- Kapitel 1: introducera vardagen, huvudpersonen, miljön och första fröet till äventyret.
- Mittenkapitel: fortsätt samma huvudäventyr. Fortsätt där förra kapitlet slutade. Starta inte om.
- Slutkapitel: knyt ihop de viktigaste trådarna, lös huvudkonflikten tydligt. Inga stora nya problem här.

### KONTINUITET
- Byt inte namn, relationer eller personlighet på huvudpersoner utan förklaring.
- Om du ser sammanfattning eller utdrag från tidigare kapitel ska du följa dem noggrant.
- Fortsätt alltid berättelsen från slutet av förra kapitlet när det är en kapitelbok.

### UTDATA
- Skriv endast själva berättelsetexten i prosa.
- Inga rubriker, inga listor, inga "Lärdomar".
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
