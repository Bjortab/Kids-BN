// functions/generate.js
// Pages Function: POST /api/generate
// BN-KIDS GC v6.4 – Continuity Lock
//
// Fokus:
// - Kapitelbok börjar INTE om när prompten är samma
// - Modell får stenhård instruktion att fortsätta där förra kapitlet slutade
// - Mindre moral-floskler, mer handling
// - Respekt för ålder + längdpreset
//
// Förväntad body (från ws_button.gc.js v6):
// {
//   prompt: string,
//   heroName: string,
//   ageGroupRaw: string,
//   lengthPreset: string,
//   storyMode: "chapter_book" | "single_story",
//   chapterIndex: number,
//   worldState: { ... },
//   totalChapters: number
// }

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

    // -------------------------------
    // Hämta historik från worldState
    // -------------------------------
    const previousSummary =
      worldState.previousSummary ||
      worldState.summary ||
      "";

    const previousChapters = Array.isArray(worldState.previousChapters)
      ? worldState.previousChapters
      : [];

    const isFirstChapter = chapterIndex <= 1;
    const isFinalChapter =
      storyMode === "chapter_book" &&
      chapterIndex >= totalChapters;

    const chapterRole = (() => {
      if (!storyMode || storyMode === "single_story") {
        return "single_story";
      }
      if (isFirstChapter) return "chapter_1";
      if (isFinalChapter) return "chapter_final";
      return "chapter_middle";
    })();

    // Kort historik: sista 2–3 kapitel, hårdkodad recap
    const compactHistory = previousChapters
      .slice(-3)
      .map((txt, idx, arr) => {
        const num = chapterIndex - (arr.length - idx);
        return `Kapitel ${num}: ${shorten(txt, 260)}`;
      })
      .join("\n\n");

    // -------------------------------
    // Systemprompt: BN-KIDS kärna
    // -------------------------------
    const systemPrompt = buildSystemPrompt_BNKids(ageKey);

    // -------------------------------
    // Användarprompt: barnets idé + roll + recap
    // -------------------------------
    const userPromptLines = [
      `Barnets idé / prompt (detta ska respekteras, inte skrivas över): "${promptRaw}"`,
      ``,
      `Hjälte: ${heroName}`,
      `Åldersband: ${ageKey} år`,
      `Längdpreset: ${String(lengthPreset || "medium")}`,
      ``,
      storyMode === "chapter_book"
        ? `Detta är kapitel ${chapterIndex} i en PÅGÅENDE kapitelbok (totalt ungefär ${totalChapters} kapitel).`
        : `Detta är en fristående saga (single_story) med början, mitt och slut.`,
      ``,
      storyMode === "chapter_book" && previousSummary
        ? `Kort sammanfattning av vad som hänt hittills:\n${shorten(previousSummary, 420)}`
        : storyMode === "chapter_book" && !previousSummary && previousChapters.length
        ? `Tidigare kapitel finns, här är några viktiga saker som hänt:\n${compactHistory || "- (ingen historik tillgänglig)"}`
        : storyMode === "chapter_book" && isFirstChapter
        ? `Det finns inga tidigare kapitel. Detta är början på boken.`
        : null,
      storyMode === "chapter_book" && previousChapters.length > 0
        ? `Några utvalda nyckelhändelser i slutet av senaste kapitlen:\n${compactHistory || "- (ingen historik tillgänglig)"}`
        : null,
      ``,
      `Kapitelroll just nu: ${chapterRole}.`,
      chapterRole === "chapter_1"
        ? `Kapitel 1 ska börja lugnt i vardagen (plats, tid, vardagsdetaljer) innan barnets idé gradvis tar över. Absolut inte starta med full action direkt, bygg upp scenen först.`
        : null,
      chapterRole === "chapter_middle"
        ? [
            `Detta är ett MITTENKAPITEL.`,
            `Du MÅSTE fortsätta där förra kapitlet slutade.`,
            `Du får INTE skriva om hur allt började igen.`,
            `Du får INTE skriva en ny "första dag" eller en ny upptäckt av skatten/dörren/portalen.`,
            `Konflikten är densamma som tidigare – samma mål, samma problem, samma värld.`,
            `Visa antingen ett nytt hinder, ett delmål eller en liten twist på vägen mot huvudmålet.`,
            `Avsluta gärna med en mjuk cliffhanger, men inte en hård tvärvändning.`,
          ].join(" "),
        : null,
      chapterRole === "chapter_final"
        ? [
            `Detta är ett AVSLUTANDE kapitel.`,
            `Du ska knyta ihop huvudkonflikten tydligt och barnvänligt.`,
            `Introducera inte nya huvudproblem eller stora nya karaktärer.`,
            `Avsluta med en varm och hoppfull känsla – men utan att skriva ut moralen som en predikan.`,
          ].join(" "),
        : null,
      ``,
      lengthInstruction,
      ``,
      `VIKTIGT:`,
      `- Skriv BARA själva berättelsetexten, utan rubriker, utan listor, utan "Lärdomar:".`,
      `- Fortsätt berättelsen logiskt framåt utifrån recap och kapitelroll.`,
      `- Upprepa inte exakt samma scen som i första kapitlet.`
    ].filter(Boolean);

    const userPrompt = userPromptLines.join("\n");

    // -------------------------------
    // OpenAI-anrop
    // -------------------------------
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
      { ok: false, error: "Serverfel", details: String(e).slice(0, 400) },
      500,
      "*"
    );
  }
}

// ================================================
// Hjälpfunktioner
// ================================================
function normalizeAge(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.includes("7") && s.includes("8")) return "7-8";
  if (s.includes("9") && s.includes("10")) return "9-10";
  if (s.includes("11") && s.includes("12")) return "11-12";
  if (s.includes("13") && s.includes("15")) return "13-15";
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
            "Skriv på ett lite mer utvecklat sätt för 9–10 år. Mer detaljer, mer dialog, men fortfarande tydligt och tryggt.",
          baseTokens: 1400
        };
      case "11-12":
        return {
          baseInstr:
            "Skriv med mer djup och tempo som passar 11–12 år. Mer känslor, mer detaljerade scener, och ibland lite humor.",
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
      ? " Denna text ska vara något kortare än normalt."
      : lp.includes("lång")
      ? " Denna text får gärna vara längre än normalt."
      : " Längden kan vara mittemellan – inte för kort, inte för lång.");

  return { lengthInstruction, maxTokens };
}

function buildSystemPrompt_BNKids(ageKey) {
  return `
Du är BN-Kids berättelsemotor. Du skriver barnanpassade sagor och kapitelböcker på svenska.

### FOKUS & GENRE
- Följ alltid barnets prompt och tema noggrant.
- Byt aldrig genre eller huvudtema på egen hand.
- Om barnet nämner ett yrke (t.ex. detektiv) ska kapitlet kretsa kring det yrket.
- Om barnet nämner ett viktigt objekt (t.ex. en magisk dörr, drakarnas land, en hemlig hiss) ska objektet fortsätta vara viktigt tills konflikten är löst.
- Undvik mörker/skräck, hotfulla skuggor och monster om barnet inte specifikt ber om det.

### ÅLDERSBAND (${ageKey})
Anpassa språk, tempo och komplexitet efter åldern:
- 7–8: enklare meningar, tydliga känslor, få karaktärer, inga subplots.
- 9–10: lite mer detaljer, lite mer spänning, max en enkel sidotråd.
- 11–12: mer djup, mer dialog, mer avancerade känslor, fortfarande tryggt.
- 13–15: något mognare, men fortfarande barnvänligt och utan grafiskt våld/sex.

### BN-FLOW (din berättarstil)
- Börja inte direkt med barnets prompt.
- Kapitel och sagor ska börja i vardagen: plats, tid, enkel aktivitet, stämning.
- Ge 3–6 meningar startscen innan magi/äventyr eller huvudproblemet dyker upp.
- Variera miljöer och objekt: använd inte alltid ekar, skattkartor, kistor, speglar eller "en röst bakom sig".
- "En röst bakom sig" eller liknande billiga skräcktriggers är förbjudna.
- Använd dialog naturligt men inte i varje mening.
- Variera meningslängd – blanda korta och längre meningar.

### MORAL & TON
- Visa känslor och värden genom handling, val och dialog — inte genom predikande meningar.
- Undvik fraser som: "det viktiga är att tro på sig själv", "du måste vara modig", "det viktigaste är vänskap" eller liknande klyschor.
- Avslut får gärna vara varma och hoppfulla, men utan att du skriver ut moralen rakt ut.
- Ingen romantik för 7–9. För 10–12 kan oskyldiga crush-känslor förekomma om barnet antyder det, men håll dem subtila och barnvänliga.

### KAPITELBOKSLÄGE
När du skriver en kapitelbok:
- Kapitel 1: introducera vardagen, huvudpersonen, miljön och det första fröet till huvudproblemet. Lugn start, öka spänningen mot slutet av kapitlet.
- Mittenkapitel: fortsätt utforska samma huvudmål. Visa hinder, framsteg och små överraskningar. Max en enkel sidotråd.
- Slutkapitel: knyt ihop de viktigaste trådarna, lös huvudkonflikten tydligt och barnvänligt. Introducera inte stora nya karaktärer eller nya huvudproblem.
- Ge gärna en mjuk cliffhanger i mittenkapitel, men inget brutalt avbrott.

### KONTINUITET
- Du får inte börja om historien när du skriver senare kapitel.
- Du får inte skriva om första dagen eller första upptäckten på nytt.
- Karaktärer får inte byta namn, kön eller personlighet utan förklaring.
- Viktiga föremål ska användas konsekvent (t.ex. draken, dörren, hissen, den magiska boken).
- Om recap eller historik ges, ska den följas lojalt.

### UTDATA
- Skriv endast berättelsetexten.
- Inga rubriker som "Kapitel 1" om inte användaren tydligt vill det.
- Inga punktlistor, inga "Lärdomar:", inga förklaringar om varför du skrev som du gjorde.
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
