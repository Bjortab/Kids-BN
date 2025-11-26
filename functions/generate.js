// functions/generate.js
// Pages Function: POST /api/generate
//
// BN-KIDS GC v7.0 – StoryEngine v11 "Hard Continuity"
//
// Fokus:
// - Kapitlen FÅR INTE börja om – fortsätt alltid samma berättelse.
// - Håll hjälte, relationer, mål och värld konsekventa.
// - Starkare kapitel-roller (första / mitten / final).
// - Mindre floskler, mindre "solig morgon" & "hjärtat bultade".
// - Samma request-format som tidigare versioner.
//
// OBS: Den här funktionen är den RIKTIGA berättelsemotorn.
// /functions/api/generate_story.js (WS-dev) är bara en proxy / dev-väg.

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

    // ------------------------------------------------------
    // Worldstate / historik
    // ------------------------------------------------------
    const previousChapters = Array.isArray(worldState.previousChapters)
      ? worldState.previousChapters
      : [];

    const previousSummary =
      worldState.previousSummary ||
      worldState.summary ||
      "";

    const lastChapterText =
      previousChapters.length > 0
        ? previousChapters[previousChapters.length - 1]
        : "";

    const shortLastScene = shortenFromEnd(lastChapterText, 450);

    const ageKey = normalizeAge(ageGroupRaw);
    const { lengthInstruction, maxTokens } = getLengthInstructionAndTokens(
      ageKey,
      lengthPreset
    );

    const isFirstChapter =
      !previousChapters.length || chapterIndex <= 1;

    const isFinalChapter =
      chapterIndex >= (totalChapters || 8) - 1;

    const chapterRole = (() => {
      if (!storyMode || storyMode === "single_story") {
        return "single_story";
      }
      if (isFirstChapter) return "chapter_1";
      if (isFinalChapter) return "chapter_final";
      return "chapter_middle";
    })();

    // Kort historik – de senaste 3 kapitlen
    const compactHistory = previousChapters
      .slice(-3)
      .map((txt, idx, arr) => {
        const chapterNo =
          (previousChapters.length - arr.length) + idx + 1;
        return `Kapitel ${chapterNo}: ${shorten(txt, 260)}`;
      })
      .join("\n\n");

    // ------------------------------------------------------
    // SYSTEMPROMPT – Hard Continuity / v11
    // ------------------------------------------------------
    const systemPrompt = buildSystemPrompt_HardContinuity(ageKey);

    // ------------------------------------------------------
    // USERPROMPT – barnets idé + kapitel-kontrakt
    // ------------------------------------------------------
    const userPromptParts = [
      `Barnets ursprungliga idé / prompt (kan upprepas varje kapitel, men historien får ALDRIG börja om): "${promptRaw}"`,
      ``,
      `Hjälte: ${heroName}`,
      `Åldersband: ${ageKey} år`,
      `Längdspreset: ${lengthPreset}`,
      `Storyläge: ${storyMode}`,
      storyMode === "chapter_book"
        ? `Detta är kapitel ${chapterIndex} i en sammanhängande kapitelbok (planerat ca ${totalChapters} kapitel).`
        : `Detta är en fristående saga (single_story).`,
      ``,
      storyMode === "chapter_book" && previousChapters.length > 0
        ? `Sammanfattning av berättelsen hittills (ALLT detta ska fortsätta gälla, du får inte skriva emot det):\n${previousSummary ? shorten(previousSummary, 600) : compactHistory || "- ingen sammanfattning sparad, använd kapitelhistoriken."}`
        : storyMode === "chapter_book"
        ? `Detta är kapitel 1. Ingen historik finns ännu – skapa starten på en berättelse som kan fortsätta i flera kapitel.`
        : null,
      storyMode === "chapter_book" && compactHistory
        ? `Några viktiga händelser i tidigare kapitel:\n${compactHistory}`
        : null,
      shortLastScene
        ? `Detta var den senaste scenen i föregående kapitel. Du MÅSTE fortsätta precis härifrån, utan att börja om:\n"${shortLastScene}"`
        : null,
      ``,
      `Kapitelroll just nu: ${chapterRole}.`,
      chapterRole === "chapter_1"
        ? `Kapitel 1 ska börja i vardagen med en lugn scen (plats, känsla, enkel aktivitet) och sedan gradvis leda in i äventyret från barnets idé. Men du får inte kalla det "första gången" varje gång, och du får inte upprepa exakt samma startfraser ("Det var en solig morgon..." etc).`
        : null,
      chapterRole === "chapter_middle"
        ? `Detta är ett MITTENKAPITEL. Fortsätt samma huvudkonflikt och samma mål som tidigare. Inga nya huvudproblem, inga stora nya karaktärer och ingen tidsresett. Visa ett tydligt delsteg, ett hinder eller en ledtråd på vägen mot slutet. Avsluta gärna med en MILD cliffhanger, men lämna dörren öppen för barnets nästa önskan.`
        : null,
      chapterRole === "chapter_final"
        ? `Detta är ETT AVSLUTANDE KAPITEL. Du får INTE starta en ny konflikt, INTE öppna nya portaler, dörrar eller världar. Knyt ihop det viktigaste som har hänt, ge ett varmt men inte överdrivet moraliskt slut. Ingen predikan – visa känslor genom handling och dialog.`
        : null,
      storyMode === "single_story"
        ? `Detta är en enda saga som börjar, utvecklas och avslutas i samma text. Den får inte kännas som flera fristående kapitel.`
        : null,
      ``,
      lengthInstruction,
      ``,
      `VIKTIGT FÖR KONTINUITETEN:`,
      `- Du får ALDRIG börja om berättelsen, hoppa tillbaka till "första dagen" eller upprepa startscenen.`,
      `- Samma hjälte ska ha samma personlighet, relationer och mål som tidigare. Byt inte roller (barn/vuxna) och blanda inte ihop namn.`,
      `- Introducera bara nya karaktärer om det verkligen behövs och om det inte sabbar fokus på huvudmålet.`,
      `- Använd inte magiska nycklar, nya dörrar, nya portaler eller teleportering om de inte redan har etablerats i historien.`,
      `- Undvik klyschor som "det var en solig morgon", "hjärtat bultade av glädje" och "plötsligt hörde han ett ljud bakom sig". Om liknande scener behövs, formulera dem på ett nytt och mer konkret sätt.`,
      ``,
      `UTDATA: Skriv ENDAST själva berättelsetexten, i löpande prosa. Inga rubriker, inga listor, inga "Lärdomar" eller förklaringar.`
    ];

    const userPrompt = userPromptParts
      .filter(Boolean)
      .join("\n");

    // ------------------------------------------------------
    // OpenAI-anrop
    // ------------------------------------------------------
    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    const payload = {
      model,
      temperature: 0.65, // lite lägre för bättre konsekvens
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
  if (s.includes("13") && (s.includes("14") || s.includes("15"))) return "13-15";
  return "9-10";
}

function getLengthInstructionAndTokens(ageKey, lengthPreset) {
  const lp = String(lengthPreset || "").toLowerCase();

  const base = (() => {
    switch (ageKey) {
      case "7-8":
        return {
          baseInstr:
            "Skriv på ett enkelt, tydligt och tryggt sätt som passar 7–8 år. Korta meningar, konkreta bilder, få karaktärer.",
          baseTokens: 900
        };
      case "9-10":
        return {
          baseInstr:
            "Skriv på ett lite mer utvecklat sätt för 9–10 år. Mer detaljer, lite mer spänning, men fortfarande tydligt och tryggt.",
          baseTokens: 1400
        };
      case "11-12":
        return {
          baseInstr:
            "Skriv med mer djup och tempo som passar 11–12 år. Mer dialog, känslor och detaljerade scener, fortfarande trygg ton.",
          baseTokens: 2000
        };
      case "13-15":
        return {
          baseInstr:
            "Skriv för 13–15 år. Något mognare språk, lite mer komplex handling och känslor, men fortfarande barnvänligt.",
          baseTokens: 2400
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

function buildSystemPrompt_HardContinuity(ageKey) {
  return `
Du är BN-Kids berättelsemotor på svenska.

Din viktigaste uppgift:
- Skriva sammanhängande barnberättelser där varje kapitel fortsätter samma historia.
- Du får ALDRIG börja om, byta huvudberättelse eller glömma tidigare kapitel.

### FOKUS & GENRE
- Följ alltid barnets ursprungliga idé noggrant.
- Byt inte genre (t.ex. från vardagsäventyr till skräck) om barnet inte tydligt ber om det.
- Om ett viktigt objekt eller plats har introducerats tidigare (t.ex. magisk bok, dörr, drake, cirkus, sagoland) så ska det fortsätta vara centralt tills konflikten är löst.

### KONTINUITET (Hard Continuity)
- Håll samma hjälte, samma relationer, samma mål och samma ton genom hela berättelsen.
- Du får inte vända på roller (t.ex. att barnet plötsligt blir förälder eller tvärtom).
- Byt inte namn på huvudpersoner eller viktiga biroller.
- Starta aldrig om historien med "första gången", "en helt vanlig dag" osv i senare kapitel.
- Om tidigare kapitel har beskrivit en plats, en portal eller ett objekt så ska det fortsätta användas konsekvent.
- Nycklar, dörrar, portaler, skattkartor eller nya världar får bara introduceras om det passar in i det som redan hänt. De ska inte ploppa upp från ingenstans i sena kapitel.

### ÅLDERSBAND (${ageKey})
- Anpassa språk, meninglängd och detaljnivå efter åldern.
- Undvik skräck och obehag för yngre barn. Håll spänning barnvänlig.
- Använd hellre konkreta bilder än abstrakta känsloord.

### STIL & FLOW
- Börja inte varje kapitel med samma typ av mening. Variera inledningarna.
- Undvik klyschor som:
  - "Det var en solig morgon"
  - "Han/Hon kände hur hjärtat bultade av glädje"
  - "Plötsligt hörde han/hon ett ljud bakom sig"
- Om liknande scener behövs, beskriv dem mer konkret och unikt.
- Använd dialog på ett naturligt sätt, men låt inte varje rad vara dialog.
- Visa känslor genom vad karaktärerna gör, säger och tänker, istället för att bara skriva ut känslan.

### MORAL & SLUT
- Visa värden (mod, vänskap, empati) genom handling – inte genom predikande slutfraser.
- Skriv inte meningar som "det viktiga är att tro på sig själv" eller "det viktigaste är vänskap".
- Avslut får gärna vara varma och hoppfulla men utan pekpinnar.

### KAPITELSTRUKTUR
- Kapitel 1: vardaglig start + första steget in i äventyret.
- Mittenkapitel: fortsätter samma mål, visar hinder och delsegrar. Mild cliffhanger är okej.
- Slutkapitel: knyter ihop de viktigaste trådarna, inga stora nya element.

### UTDATA
- Skriv endast berättelsen i löpande text.
- Inga rubriker (om inte användaren uttryckligen ber om det).
- Inga punktlistor och inga förklaringar om varför du skrev texten.
`.trim();
}

function shorten(text, maxLen) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

function shortenFromEnd(text, maxLen) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length <= maxLen) return s;
  return "…" + s.slice(s.length - (maxLen - 1));
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
