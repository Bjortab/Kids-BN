// functions/generate.js
// Pages Function: POST /api/generate
// Ny GC-version för BN-Kids – med förbättrad ton, kapitelstöd och fokuslås.

// OBS: Den här funktionen är den RIKTIGA berättelsemotorn.
// /functions/api/generate_story.js är bara en proxy. Rör inte dess signatur.

export async function onRequestOptions({ env }) {
  const origin =
    env.KIDSBM_ALLOWED_ORIGIN ||
    env.KIDSBM_ALLOW_ORIGIN ||
    env.KIDSBM_ALLOWED_ORIGIN_DEV ||
    env.KIDSBM_ALLOWED_ORIGIN_LOCAL ||
    env.KIDSBM_ALLOWED_ORIGIN_PREVIEW ||
    env.KIDSBM_ALLOWED_ORIGIN_PROD ||
    env.KIDSBM_ALLOWED_ORIGIN_KIDS ||
    env.KIDSBM_ALLOWED_ORIGIN_BN ||
    env.KIDSBM_ALLOWED_ORIGIN_KIDSBM ||
    env.KIDSBN_ALLOWED_ORIGIN ||
    "*";

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export async function onRequestPost({ request, env }) {
  const origin =
    env.KIDSBM_ALLOWED_ORIGIN ||
    env.KIDSBN_ALLOWED_ORIGIN ||
    env.KIDSBM_ALLOW_ORIGIN ||
    "*";

  try {
    const body = (await request.json().catch(() => ({}))) || {};

    const prompt = String(body.prompt || "").trim();
    const heroNameRaw = String(body.kidName || body.heroName || "").trim();
    const heroName = heroNameRaw || "hjälten"; // ALDRIG "Vännen" längre
    const ageGroupRaw = String(body.ageGroup || body.ageRange || "7–8 år").trim();

    // Kapitelinfo (om WS skickar med — annars ignoreras)
    const chapterIndex =
      typeof body.chapterIndex === "number" ? body.chapterIndex : null;
    const totalChapters =
      typeof body.totalChapters === "number" ? body.totalChapters : null;
    const isFinalChapter =
      typeof body.isFinalChapter === "boolean"
        ? body.isFinalChapter
        : body.lastChapter === true;

    const storyModeRaw = String(body.storyMode || body.mode || "").trim();
    const storyMode =
      storyModeRaw === "chapter_book" || storyModeRaw === "chapter"
        ? "chapter_book"
        : "single_story";

    if (!prompt) {
      return json(
        { error: "Skriv eller spela in vad sagan ska handla om först." },
        400,
        origin
      );
    }

    if (!env.OPENAI_API_KEY) {
      return json(
        { error: "OPENAI_API_KEY saknas i backend-miljön." },
        500,
        origin
      );
    }

    const ageKey = normalizeAge(ageGroupRaw);
    const { lengthInstruction, maxTokens, ageBandLabel } =
      getLengthInstructionAndTokens(ageKey);

    // --------------------------------------------------------
    // SYSTEM-PROMPT – BN-KIDS V10.3 (GC)
    // Här lägger vi in FLE, kapitel-logik, ton, romantikregler osv.
    // --------------------------------------------------------

    const SYSTEM_PROMPT_BN_KIDS = `
Du är BN-Kids berättelsemotor. Du skriver barnvänliga sagor och kapitel på svenska.

DINA HUVUDUPPGIFTER
- Följ barnets önskan/prompt noggrant.
- Håll en tydlig röd tråd genom hela kapitlet.
- Anpassa språk, längd och komplexitet efter åldersbandet: ${ageBandLabel}.

FLE – FOCUS LOCK ENGINE
1. Fokusera alltid på det barnet ber om.
2. Byt inte genre, ton eller huvudtema på eget initiativ.
3. Om barnet nämner ett yrke (t.ex. fotbollsmålvakt, detektiv, forskare) ska kapitlet kretsa kring:
   – vardag + känslor + träning/arbete + små sidospår
   – inte bara en upprepning av samma aktivitet varje mening.
4. Om barnet nämner ett objekt (t.ex. en magisk bok, drönare, flodhästar, drakar, skattkarta):
   – objektet ska vara centralt för kapitlet
   – MEN du får bygga en värld runt om: hem, skola, familj, vänner, miljö, känslor.
5. Undvik att låta huvudpersonen gå runt och tänka "jag är så stark, jag är bäst, jag är superhjälte".
   – Visa styrka genom handlingar, mod och omtanke, inte genom tjat om hur stark hen är.

ÅLDERSBAND
- junior_7_9:
  – enkel men levande prosa
  – trygg ton, humor, tydliga känslor
  – ingen skräck
  – "onde krafter" får finnas, men mjuka och barnvänliga, t.ex. busiga flodhästar som förstör lekplatsen av misstag.
- mid_10_12:
  – mer djup i känslor, konflikter, vänskap, mod, oro
  – EN enkel subplot är okej (t.ex. en relation, ett sidomål).
  – Lätt romantik är tillåten om barnet ber om det, men alltid respektfull, varm och barnvänlig.

ROMANTIK (10–12 år)
- Romantik ska vara mjuk:
  – pirr i magen, vilja vara nära, leenden, nervositet, mod att våga säga något snällt.
- Inga kyssar i detalj, ingen vuxen romantik.
- Romantiken får ALDRIG ta över hela berättelsen – huvudäventyret är alltid viktigast.

STORYLÄGE
- single_story:
  – Skriv en komplett saga där huvudproblemet introduceras och löses.
- chapter_book:
  – Barnet/klienten kommer att skicka flera prompts – detta är ETT kapitel i en längre bok.
  – Kapitel 1:
    * Börja lugnt: vardag, miljö, vem ${heroName} är, var hen bor, relationer.
    * Första halvan får gärna vara vardag och förväntan, sedan smyger du in huvudkonflikten.
  – Mellankapitel:
    * Driv huvudmålet framåt, ge hinder, små delsegrar.
    * Inga nya stora konflikter som tar över.
  – Sista kapitlet:
    * Lös huvudkonflikten tydligt.
    * Inga nya stora problem.
    * Avsluta varmt, hoppfullt eller med lugn epilog.

TON OCH STIL
1. Använd ett berättande flow som känns naturligt, som en bra högläsningsbok.
2. Undvik upprepningar som:
   – "hjärtat bultade av förväntan" i varje scen
   – "han/hon log stort" i varje stycke
   – återkommande glitter/skatter/kistor om prompten inte specifikt handlar om det.
3. Variera känslor och formuleringar:
   – glädje, oro, nyfikenhet, lätt nervositet, mod, beslutsamhet, lättnad.
4. Moralen:
   – Får gärna vara positiv, men inte övertydlig "moralkaka" varje gång.
   – Variera slut: humor, lugn, hopp, "nu väntar nästa äventyr", lärdomar – inte alltid "vänner hjälper alltid varandra".
5. Namn och konsekvens:
   – Byt aldrig namn på viktiga karaktärer.
   – Om en figur är en kanin i ett kapitel ska den inte bli en hund i nästa.
   – Byt inte kön, djurart eller roll på samma figur.

FÖRBJUDNA INSLAG UTAN ATT BARNET BER OM DET
- skräck, hotfullt mörker, otäcka skuggor, demoner, spöken, grafiskt våld.
- hoppa aldrig plötsligt till vuxna teman.

START AV KAPITEL
- Börja INTE varje kapitel rakt på barnets promptmening.
- Ge först en kort "landning":
  – var befinner sig ${heroName}?
  – tid på dagen, miljö, känsla, ev. kort återkoppling till vad som hände sist (om det är kapitelbok).
- Sedan kan du låta händelserna från prompten sätta igång.

KAPITELLOGIK (INTERN)
- Huvudmålet ska kännas tydligt i varje kapitel.
- Du får ha sidospår, men de ska stötta huvuduppdraget (inte ersätta det).
- Om kapitlet är mitt i boken:
  – Låt det sluta i en mjuk cliffhanger eller med en ny fråga, inte med fullständig lösning.
- Om kapitlet är sista:
  – Knyt ihop de viktigaste trådarna, ge ett tillfredsställande slut.

KONSISTENSKONTROLL (MENTALT EFTER DU SKRIVIT)
- Följde du barnets prompt och tema?
- Höll du rätt genre och ton?
- Höll du dig inom åldersbandets nivå?
- Behöll du namn, fakta och objekt konsekventa?
- Blev längden ungefär som instruktionen beskriver?

SVARFORMAT
- Svara ENDAST med själva berättelsetexten.
- Inga rubriker, inga etiketter som "Kapitel 1:", inga förklaringar utanför berättelsen.
`;

    // Bygg användarens meddelande med lite struktur
    const userMessageParts = [];

    userMessageParts.push(
      `Barnets önskan/prompt:\n"${prompt}".`
    );

    userMessageParts.push(
      `Hjälte (namn): ${heroName}. Åldersband: ${ageBandLabel}.`
    );

    userMessageParts.push(lengthInstruction);

    if (storyMode === "chapter_book") {
      const chapterMeta = [];
      if (typeof chapterIndex === "number") {
        chapterMeta.push(`Detta är kapitel ${chapterIndex + 1} i en pågående kapitelbok.`);
      } else {
        chapterMeta.push(
          "Detta är ett kapitel i en pågående kapitelbok (exakt nummer är inte så viktigt)."
        );
      }
      if (typeof totalChapters === "number") {
        chapterMeta.push(`Boken planeras ha ungefär ${totalChapters} kapitel.`);
      }
      if (isFinalChapter) {
        chapterMeta.push("Detta kapitel ska avsluta bokens huvudproblem på ett tydligt sätt.");
      } else {
        chapterMeta.push(
          "Detta kapitel ska driva huvudmålet framåt men inte avsluta hela boken."
        );
      }
      userMessageParts.push(chapterMeta.join(" "));
    } else {
      userMessageParts.push(
        "Detta är en fristående saga som ska kännas komplett i sig själv."
      );
    }

    const userMessage = userMessageParts.join("\n\n");

    const payload = {
      model: env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.85,
      messages: [
        { role: "system", content: SYSTEM_PROMPT_BN_KIDS },
        { role: "user", content: userMessage },
      ],
    };

    if (maxTokens) {
      payload.max_tokens = maxTokens;
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return json(
        {
          error: "OpenAI-fel",
          details: text.slice(0, 300),
        },
        502,
        origin
      );
    }

    const data = await res.json().catch(() => ({}));
    const storyRaw =
      data?.choices?.[0]?.message?.content?.trim() ||
      "Det blev ett tekniskt fel, försök igen.";

    return json({ story: storyRaw }, 200, origin);
  } catch (e) {
    return json(
      {
        error: e?.message || "Serverfel",
      },
      500,
      origin
    );
  }
}

// --------------------------------------------------------
// Hjälpfunktioner
// --------------------------------------------------------

function normalizeAge(raw) {
  const s = String(raw || "").toLowerCase();

  if (s.includes("7-8") || s.includes("7–8")) return "7-8";
  if (s.includes("9-10") || s.includes("9–10")) return "9-10";
  if (s.includes("10-12") || s.includes("10–12") || s.includes("11-12") || s.includes("11–12"))
    return "11-12";
  if (s.includes("13-15") || s.includes("13–15")) return "13-15";

  // Fallback: behandla som 7–8
  return "7-8";
}

function getLengthInstructionAndTokens(ageKey) {
  switch (ageKey) {
    case "7-8":
      return {
        ageBandLabel: "7–8 år (junior)",
        lengthInstruction:
          "Skriv ett kapitel eller en saga för 7–8 år: enkel men levande handling, tydliga karaktärer, cirka 400–600 ord.",
        maxTokens: 900,
      };
    case "9-10":
      return {
        ageBandLabel: "9–10 år (mellan)",
        lengthInstruction:
          "Skriv ett kapitel eller en saga för 9–10 år: mer handling och beskrivningar, cirka 600–900 ord.",
        maxTokens: 1400,
      };
    case "11-12":
      return {
        ageBandLabel: "11–12 år (äldre mellanstadie)",
        lengthInstruction:
          "Skriv ett kapitel eller en saga för 11–12 år: djupare känslor och mer utvecklad intrig, cirka 900–1200 ord.",
        maxTokens: 2000,
      };
    case "13-15":
      return {
        ageBandLabel: "13–15 år (early teen)",
        lengthInstruction:
          "Skriv ett kapitel eller en saga för 13–15 år: mogen men ändå trygg ton, mer komplex handling och utvecklade karaktärer, cirka 1000–1600 ord.",
        maxTokens: 2500,
      };
    default:
      return {
        ageBandLabel: "okänt åldersband (behandla som 7–8 år)",
        lengthInstruction:
          "Skriv en saga anpassad för barn – håll språket tydligt och tryggt.",
        maxTokens: 900,
      };
  }
}

function json(obj, status = 200, origin = "*") {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin,
    },
  });
}
