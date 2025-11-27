// functions/generate.js
// Pages Function: POST /api/generate
//
// BN-KIDS GC v6.5 – fokus:
// - HÅRD låsning av kapiteltråden (ingen omstart i kapitel 2+)
// - Bättre kapitelroll: start / mitten / final
// - Mindre moral-floskler
// - Hjälten från formuläret är huvudperson, även om prompten nämner andra
//
// OBS: Det här är den RIKTIGA berättelsemotorn för BN-Kids.
// /functions/api/generate_story_js är bara en proxy i dev-läget.

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

    const heroNameRaw =
      body.heroName ||
      body.kidName ||
      body.hero ||
      "";

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

    // ------------------------------------------------------
    // Härifrån: bygga promtar
    // ------------------------------------------------------
    const heroName = heroNameRaw || worldState?.meta?.hero || "hjälten";
    const ageKey = normalizeAge(ageGroupRaw);

    const {
      lengthInstruction,
      maxTokens,
      temperature
    } = getLengthInstructionAndTokens(ageKey, lengthPreset);

    const previousSummary =
      worldState.previousSummary ||
      worldState.summary ||
      "";

    const previousChapters = Array.isArray(worldState.previousChapters)
      ? worldState.previousChapters
      : [];

    const lastChapterText = previousChapters.length
      ? previousChapters[previousChapters.length - 1]
      : "";

    const lastChapterRecap = lastChapterText
      ? shorten(lastChapterText, 380)
      : "";

    const lastChapterLastLine = lastChapterText
      ? lastChapterText
          .trim()
          .split(/[\r\n]+/)
          .filter(Boolean)
          .slice(-2)
          .join(" ")
      : "";

    const isFirstChapter = chapterIndex <= 1;
    const isFinalChapter = chapterIndex >= totalChapters;

    const chapterRole = (() => {
      if (!storyMode || storyMode === "single_story") return "single_story";
      if (isFirstChapter) return "chapter_1";
      if (isFinalChapter) return "chapter_final";
      return "chapter_middle";
    })();

    // Kort historiklista
    const compactHistory = previousChapters.length
      ? previousChapters
          .slice(-3)
          .map((txt, idx, arr) => {
            const n = previousChapters.length - (arr.length - 1 - idx);
            return `Kapitel ${n}: ${shorten(txt, 260)}`;
          })
          .join("\n\n")
      : "";

    // ------------------------------------------------------
    // SYSTEMPROMPT – hård kapitel-låsning
    // ------------------------------------------------------
    const systemPrompt = buildSystemPrompt_BNKids(
      ageKey,
      chapterRole,
      storyMode
    );

    // ------------------------------------------------------
    // USERPROMPT – barnets idé + worldstate + "börja inte om"
    // ------------------------------------------------------

    const userLines = [];

    userLines.push(`Barnets idé / prompt (senaste versionen): "${promptRaw}"`);
    userLines.push("");
    userLines.push(`Hjälte (huvudperson): ${heroName}`);
    userLines.push(`Åldersband: ${ageKey} år`);
    userLines.push(`Längdspreset: ${lengthPreset}`);
    userLines.push(`Storyläge: ${storyMode || "chapter_book"}`);

    if (storyMode === "chapter_book") {
      userLines.push(
        `Detta är KAPITEL ${chapterIndex} av ca ${totalChapters} kapitel i en pågående kapitelbok.`
      );
    } else {
      userLines.push("Detta är en fristående saga (single_story).");
    }

    userLines.push("");

    if (storyMode === "chapter_book") {
      userLines.push(
        "Tidigare i boken – kort sammanfattning (ska följas noggrant):"
      );
      userLines.push(
        previousSummary
          ? shorten(previousSummary, 420)
          : "Ingen sammanfattning sparad ännu – anta att detta är början."
      );
      userLines.push("");

      if (compactHistory) {
        userLines.push("Viktiga saker som hänt i tidigare kapitel:");
        userLines.push(compactHistory);
        userLines.push("");
      }

      if (lastChapterLastLine) {
        userLines.push(
          "Så här slutade förra kapitlet (du ska fortsätta efter detta, inte börja om):"
        );
        userLines.push(lastChapterLastLine);
        userLines.push("");
      }

      userLines.push(
        `Kapitelroll just nu: ${chapterRole} (du måste följa riktlinjerna i systemprompten för denna kapiteltyp).`
      );

      if (chapterRole === "chapter_1") {
        userLines.push(
          "Kapitel 1 ska starta i en lugn vardagsscen innan äventyret drar igång. Visa miljö, tid på dagen, vardagsaktivitet. Låt sedan barnets idé gradvis driva in i äventyret."
        );
      } else if (chapterRole === "chapter_middle") {
        userLines.push(
          "Detta är ett MITTENKAPITEL. Du får ABSOLUT INTE börja om berättelsen eller hoppa tillbaka till första dagen. Du ska fortsätta från föregående kapitel, visa ett nytt hinder eller delmål, och avsluta med en mjuk cliffhanger. Ingen ny huvudkonflikt."
        );
      } else if (chapterRole === "chapter_final") {
        userLines.push(
          "Detta är ett SLUTKAPITEL. Du ska knyta ihop trådarna från tidigare kapitel, lösa huvudproblemet och landa i ett lugnt, hoppfullt slut. Du får inte introducera helt nya huvudproblem eller huvudpersoner."
        );
      }

      userLines.push("");
      userLines.push(
        "Mycket viktigt: I kapitel 2 och framåt får du inte börja med generiska meningar som 'Det var en solig lördag...' eller 'En dag i skolan...'. Du är redan inne i äventyret – fortsätt där historien befinner sig nu."
      );
    }

    userLines.push("");
    userLines.push(lengthInstruction);
    userLines.push("");
    userLines.push(
      `Hjälten ${heroName} ska vara den tydliga huvudpersonen. Om prompten nämner andra personer (t.ex. en förälder) får de vara viktiga, men berättelsen ska följa ${heroName}s perspektiv.`
    );
    userLines.push("");
    userLines.push(
      "UTDATA: Skriv bara själva berättelsen i löpande text. Inga rubriker, inga punktlistor, inga 'Lärdomar'. Ingen förklaring om varför du skrev som du gjorde."
    );

    const userPrompt = userLines.join("\n");

    // ------------------------------------------------------
    // OpenAI-anrop
    // ------------------------------------------------------

    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    const payload = {
      model,
      temperature,
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

// ------------------------------------------------------
// Hjälpfunktioner
// ------------------------------------------------------

function normalizeAge(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.includes("7") && s.includes("8")) return "7-8";
  if (s.includes("9") && s.includes("10")) return "9-10";
  if (s.includes("11") && s.includes("12")) return "11-12";
  if (s.includes("13") && (s.includes("14") || s.includes("15"))) return "13-15";
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
          baseTokens: 900,
          baseTemp: 0.6
        };
      case "9-10":
        return {
          baseInstr:
            "Skriv på ett lite mer utvecklat sätt för 9–10 år. Mer detaljer, mer dialog, men fortfarande tydligt och tryggt.",
          baseTokens: 1400,
          baseTemp: 0.65
        };
      case "11-12":
        return {
          baseInstr:
            "Skriv med mer djup och tempo som passar 11–12 år. Mer känslor, mer detaljerade scener, och ibland lite humor.",
          baseTokens: 2000,
          baseTemp: 0.7
        };
      case "13-15":
        return {
          baseInstr:
            "Skriv för yngre tonåringar 13–15. Mogen men trygg ton, lite mer komplex handling, men fortfarande barnvänligt.",
          baseTokens: 2500,
          baseTemp: 0.75
        };
      default:
        return {
          baseInstr:
            "Skriv en saga anpassad för barn. Tydligt, tryggt och åldersanpassat.",
          baseTokens: 1600,
          baseTemp: 0.65
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
      : " Längden kan vara mittemellan – inte för kort, inte för lång.");

  // Lite lägre temp för kort/långa 7–10 år – mer stabilitet
  let temperature = base.baseTemp;
  if (lp.includes("kort")) temperature -= 0.05;
  if (lp.includes("lång")) temperature += 0.05;
  if (temperature < 0.5) temperature = 0.5;
  if (temperature > 0.85) temperature = 0.85;

  return { lengthInstruction, maxTokens, temperature };
}

function buildSystemPrompt_BNKids(ageKey, chapterRole, storyMode) {
  return `
Du är BN-Kids berättelsemotor. Din uppgift är att skriva barnanpassade sagor och kapitelböcker på svenska.

### FOKUS & GENRE
- Följ alltid barnets prompt och tema noggrant.
- Byt aldrig genre eller huvudtema på egen hand.
- Om barnet nämner ett yrke (t.ex. detektiv) ska kapitlet kretsa kring det yrket.
- Om barnet nämner ett viktigt objekt (t.ex. en magisk dörr, drakarnas land, en hemlig hiss) ska objektet vara centralt tills konflikten är löst.
- Undvik mörker/skräck, hotfulla skuggor och monster om barnet inte specifikt ber om det.

### ÅLDERSBAND (${ageKey})
Anpassa språk, tempo och komplexitet efter åldern:
- 7–8: enklare meningar, tydliga känslor, få karaktärer, inga subplots.
- 9–10: lite mer detaljer, lite mer spänning, max en enkel sidotråd.
- 11–12: mer djup, mer dialog, mer avancerade känslor, fortfarande tryggt.
- 13–15: något mognare, men fortfarande barnvänligt och utan grafiskt våld/sex.

### BN-FLOW LAYER (din stil)
- Kapitel (och fristående sagor) ska ha ett naturligt flyt.
- Variera miljöer och objekt: använd inte alltid ekar, skattkartor, kistor, speglar eller "en röst bakom dem".
- "En röst bakom sig" eller liknande billiga skräcktriggers är förbjudna.
- Använd dialog naturligt, men inte i varje mening.
- Variera meningslängd. Blanda korta och längre meningar.

### KAPITELBOKSLÄGE (story_mode = ${storyMode}, chapter_role = ${chapterRole})
När du skriver en kapitelbok:
- Kapitel 1: introducera vardagen, huvudpersonen, miljön och det första fröet till huvudproblemet. Lugn start, öka spänningen mot slutet av kapitlet.
- Mittenkapitel: fortsätt utforska samma huvudmål. Visa hinder, framsteg och små överraskningar. Max en enkel sidotråd.
- Slutkapitel: knyt ihop de viktigaste trådarna, lös huvudkonflikten tydligt och barnvänligt. Introducera inte stora nya karaktärer eller nya huvudproblem.

**Mycket viktigt om chapter_role = "chapter_middle" eller "chapter_final":**
- Du får ABSOLUT INTE börja om berättelsen eller skriva en ny "introduktionsscen" där allt startar från början.
- Du ska fortsätta där förra kapitlet slutade, både i handling och känsla.
- Undvik generiska vardagsöppningar (t.ex. "Det var en solig lördag..." eller "En dag i skolan...") om detta redan beskrivits.
- Håll samma huvudpersoner, samma grundmiljö och samma huvudproblem.

### MORAL & TON
- Visa känslor och värden genom handling, val och dialog — inte genom predikande meningar.
- Undvik fraser som: "det viktiga är att tro på sig själv", "du måste vara modig", "det viktigaste är vänskap".
- Avslut får gärna vara varma och hoppfulla, men utan att skriva ut moralen rakt ut.
- Ingen romantik för 7–9. För 10–12 kan oskyldiga crush-känslor förekomma om barnet antyder det, men håll dem subtila och barnvänliga.

### KONTINUITET
- Karaktärer får inte byta namn, kön eller personlighet utan förklaring.
- Viktiga föremål (t.ex. draken, dörren, hissen, den magiska boken) ska användas konsekvent.
- Om sammanfattning eller kapitelbeskrivningar finns ska de följas lojalt.
- Om förra kapitlet slutade med en specifik scen eller fråga ska nästa kapitel kännas som en naturlig fortsättning.

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
