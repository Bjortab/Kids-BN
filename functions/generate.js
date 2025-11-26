// functions/generate.js
// Pages Function: POST /api/generate
//
// BN-KIDS GC v7.1 – StoryEngine Hard Continuity++
//
// Fokus:
// - Kapitel 2+ ska kännas som DIREKT FORTSÄTTNING, inte ny episod.
// - Första meningen i ett nytt kapitel ska kunna följa direkt på slutet av förra.
// - Håller ihop hjälte, relationer, mål, platser.
// - Mindre floskler och upprepade "solig morgon" / "hjärtat bultade" osv.
// - Samma request-format som tidigare, så frontend (WS GC v6.x) kan vara orörd.

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

    const lastScene = shortenFromEnd(lastChapterText, 600);
    const fullHistory = previousChapters.join("\n\n---\n\n");
    const historyWindow = middleWindow(fullHistory, 2200);

    const ageKey = normalizeAge(ageGroupRaw);
    const { lengthInstruction, maxTokens } = getLengthInstructionAndTokens(
      ageKey,
      lengthPreset
    );

    const hasHistory = previousChapters.length > 0;
    const isFirstChapter = !hasHistory || chapterIndex <= 1;
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

    // ------------------------------------------------------
    // SYSTEMPROMPT – Hard Continuity
    // ------------------------------------------------------
    const systemPrompt = buildSystemPrompt_HardContinuity(ageKey);

    // ------------------------------------------------------
    // USERPROMPT – barnets idé + kapitel-kontrakt
    // ------------------------------------------------------
    const userParts = [];

    userParts.push(
      `Barnets ursprungliga idé / prompt (kan upprepas varje kapitel, men berättelsen får ALDRIG börja om): "${promptRaw}"`
    );
    userParts.push("");
    userParts.push(`Hjälte: ${heroName}`);
    userParts.push(`Åldersband: ${ageKey} år`);
    userParts.push(`Längdspreset: ${lengthPreset}`);
    userParts.push(`Storyläge: ${storyMode}`);
    if (storyMode === "chapter_book") {
      userParts.push(
        `Du skriver kapitel ${chapterIndex} i en sammanhängande kapitelbok (ca ${totalChapters} kapitel).`
      );
    } else {
      userParts.push(
        "Du skriver en enda fristående saga (single_story)."
      );
    }
    userParts.push("");

    if (storyMode === "chapter_book") {
      if (hasHistory) {
        userParts.push(
          "Detta är kanon (allt detta har redan hänt och får INTE skrivas om eller ignoreras):"
        );
        if (previousSummary) {
          userParts.push(shorten(previousSummary, 700));
        }
        if (historyWindow) {
          userParts.push("");
          userParts.push("Utdrag ur tidigare kapitel (för känsla och kontinuitet):");
          userParts.push(historyWindow);
        }
        if (lastScene) {
          userParts.push("");
          userParts.push(
            "Sista scenen i föregående kapitel (DU MÅSTE FORTSÄTTA DIREKT HÄRIFRÅN, utan att börja om):"
          );
          userParts.push(`"${lastScene}"`);
        }
      } else {
        userParts.push(
          "Detta är kapitel 1. Ingen historik finns ännu – skapa starten på en berättelse som kan fortsätta i flera kapitel."
        );
      }
    }

    userParts.push("");
    userParts.push(`Kapitelroll just nu: ${chapterRole}.`);

    if (chapterRole === "chapter_1") {
      userParts.push(
        "Kapitel 1 ska börja i vardagen med en lugn, konkret scen (plats, känsla, enkel aktivitet) och sedan gradvis leda in i äventyret från barnets idé."
      );
      userParts.push(
        "Du får gärna nämna väder eller stämning, men undvik klyschan 'det var en solig morgon' och liknande standardfraser."
      );
    } else if (chapterRole === "chapter_middle") {
      userParts.push(
        "Detta är ett MITTENKAPITEL. Du får INTE starta en ny berättelse, ny värld eller ny portal."
      );
      userParts.push(
        "Första meningen i detta kapitel ska kännas som NÄSTA MENING efter slutet på föregående kapitel, inte som en ny början. Ingen 'några dagar senare', ingen ny vardagsscen."
      );
      userParts.push(
        "Fortsätt samma huvudmål, samma plats(er) och samma viktiga föremål som tidigare. Visa ett delsteg, ett hinder eller en ledtråd på vägen mot slutet."
      );
    } else if (chapterRole === "chapter_final") {
      userParts.push(
        "Detta är ETT AVSLUTANDE KAPITEL. Du får INTE börja ett nytt äventyr, öppna nya dörrar/portaler eller introducera en helt ny huvudkonflikt."
      );
      userParts.push(
        "Fortsätt direkt från föregående scen och knyt ihop de viktigaste trådarna. Ge ett varmt, hoppfullt men inte moralpredikande slut."
      );
    } else if (chapterRole === "single_story") {
      userParts.push(
        "Detta är en fristående saga som börjar, utvecklas och avslutas inom samma text. Den ska inte kännas som flera separata kapitel."
      );
    }

    userParts.push("");
    userParts.push(lengthInstruction);
    userParts.push("");

    userParts.push("VIKTIGT FÖR KONTINUITETEN:");
    userParts.push(
      "- Du får ALDRIG börja om med en ny första dag eller helt ny startscen i kapitel 2 och framåt."
    );
    userParts.push(
      "- Håll samma hjälte, samma relationer (barn/förälder, kompisar osv) och samma grundproblem genom hela boken."
    );
    userParts.push(
      "- Vänd inte på rollerna (barnet ska inte plötsligt vara förälder, en pappa blir inte barn osv)."
    );
    userParts.push(
      "- Byt inte namn på viktiga karaktärer och ändra inte deras personlighet utan tydlig förklaring."
    );
    userParts.push(
      "- Introducera nya magiska nycklar, dörrar, portaler, skattkartor eller världar bara om det tydligt bygger vidare på sådant som redan har nämnts."
    );
    userParts.push(
      "- Undvik klyschor som 'det var en solig morgon', 'hjärtat bultade av glädje' och 'plötsligt hörde han/hon ett ljud bakom sig'. Om liknande scener behövs, formulera dem på ett nytt sätt."
    );
    userParts.push("");
    userParts.push(
      "UTDATA: Skriv ENDAST själva berättelsetexten i löpande prosa. Inga rubriker, inga punktlistor, inga 'Lärdomar', inga meta-kommentarer."
    );

    const userPrompt = userParts.join("\n");

    // ------------------------------------------------------
    // OpenAI-anrop
    // ------------------------------------------------------
    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    const payload = {
      model,
      temperature: 0.55, // ännu lägre för bättre konsekvens
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

DIN ROLL:
- Skriva sammanhängande barnberättelser där varje kapitel fortsätter samma historia.
- Du får ALDRIG börja om, byta ut grundidén eller ignorera kanon.

### FOKUS & GENRE
- Följ barnets ursprungliga idé noggrant.
- Byt inte genre om inte barnet tydligt ber om det.
- Viktiga objekt och platser (magisk bok, hiss, cirkus, stall osv) ska fortsätta vara centrala tills konflikten är löst.

### KONTINUITET (Hard Continuity)
- Håll samma hjälte, samma relationer och samma mål i alla kapitel.
- Vänd inte på roller (barn ⇄ vuxen) utan tydlig magisk förklaring.
- Byt inte namn eller personlighet på huvudpersoner.
- Starta aldrig om historien i kapitel 2+: inga nya "första dagar", inga nya helt fristående äventyr.
- Om en plats, portal eller nyckel redan etablerats ska den användas konsekvent, inte slumpas in sent utan koppling.

### ÅLDERSBAND (${ageKey})
- Anpassa ordval, längd på meningar och mängd detaljer efter åldern.
- Håll spänningen barnvänlig. Ingen skräck, inget grovt våld.

### STIL & FLOW
- Variera inledningar – återanvänd inte klyschor som:
  - "Det var en solig morgon"
  - "Han/Hon kände hur hjärtat bultade av glädje"
  - "Plötsligt hörde han/hon ett ljud bakom sig"
- Om liknande scener behövs, skriv dem mer konkret och unikt.
- Använd dialog naturligt, blandat med beskrivningar.
- Visa känslor genom handling, dialog och detaljer i miljön.

### MORAL & SLUT
- Visa värden genom vad karaktärerna gör, inte genom predikande meningar.
- Undvik formuleringar som "det viktigaste är vänskap" eller "du måste tro på dig själv".
- Slut kan vara varma och hoppfulla, men utan pekpinnar.

### KAPITELSTRUKTUR
- Kapitel 1: lugn vardaglig start + första steget in i äventyret.
- Mittenkapitel: fortsätter samma huvudmål, visar hinder och delsteg. Mild cliffhanger är okej.
- Slutkapitel: knyter ihop trådarna, löser huvudkonflikten, inga stora nya element.

### UTDATA
- Skriv ENDAST berättelsetext.
- Inga rubriker (om inte användaren vill det).
- Inga punktlistor, inga "Lärdomar:", inga meta-kommentarer.
`.trim();
}

function shorten(text, maxLen) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

// Tar sista maxLen tecken (för "fortsätt härifrån"-känsla)
function shortenFromEnd(text, maxLen) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length <= maxLen) return s;
  return s.slice(s.length - maxLen);
}

// Plockar ett "fönster" i mitten/slutet av historiken (för att få både känsla & närtid)
function middleWindow(text, maxLen) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length <= maxLen) return s;
  // Ta en bit från senare delen av texten, men inte bara allra sista
  const start = Math.max(0, s.length - maxLen - 400);
  return s.slice(start, start + maxLen);
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
