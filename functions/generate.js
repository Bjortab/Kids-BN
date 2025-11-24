// functions/generate.js
// Pages Function: POST /api/generate
// BN-KIDS GC v4.1 – fokus på:
// - Bättre författarton (BN-Flow Layer)
// - Starkare kapitelkänsla (8–12 kapitel, fortsätt samma bok)
// - Mindre moral-floskler
// - Mindre ekar/kistor/kartor-repeat
// - Respekt för barnets prompt, hjälte och ålder

export async function onRequestOptions({ env }) {
  const origin = getAllowedOrigin(env);

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
  const origin = getAllowedOrigin(env);

  try {
    const body = (await request.json().catch(() => ({}))) || {};

    // --------- Grunddata från body + worldState/meta ----------
    const worldState = body.worldState || {};
    const meta = worldState.meta || {};

    const promptRaw =
      body.prompt ||
      body.storyPrompt ||
      body.childPrompt ||
      meta.originalPrompt ||
      "";

    const heroName =
      body.heroName ||
      body.kidName ||
      body.hero ||
      meta.hero ||
      meta.childName ||
      "hjälten";

    const ageGroupRaw =
      body.ageGroupRaw ||
      body.ageGroup ||
      body.ageRange ||
      body.age ||
      meta.ageValue ||
      meta.ageLabel ||
      "7–8 år";

    const lengthPreset =
      body.lengthPreset ||
      body.length ||
      body.lengthValue ||
      meta.lengthValue ||
      meta.lengthLabel ||
      "lagom";

    const incomingStoryMode =
      body.storyMode ||
      body.story_mode ||
      worldState.story_mode ||
      meta.storyMode ||
      "";

    const chapterIndex = Number(
      body.chapterIndex || worldState.chapterIndex || meta.chapterIndex || 1
    );

    // Om vi har chapterIndex > 1 → tvinga kapitelboksläge
    const storyMode =
      incomingStoryMode ||
      (chapterIndex > 1 ? "chapter_book" : "single_story");

    const totalChapters = Number(
      body.totalChapters ||
        meta.totalChapters ||
        worldState.totalChapters ||
        8
    );

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

    // ------------------------------------------------------
    // BN-KIDS SYSTEMPROMPT – Core + Flow + Kapitel
    // ------------------------------------------------------
    const systemPrompt = buildSystemPrompt_BNKids(ageKey);

    // ------------------------------------------------------
    // USERPROMPT – barnets idé + worldstate + kapitelroll
    // ------------------------------------------------------

    const previousSummary =
      worldState.previousSummary ||
      worldState.summary ||
      "";

    const previousChapters = Array.isArray(worldState.previousChapters)
      ? worldState.previousChapters
      : [];

    const isFirstChapter = chapterIndex <= 1;
    const isFinalChapter = chapterIndex >= totalChapters;

    const chapterRole = (() => {
      if (!storyMode || storyMode === "single_story") {
        return "single_story";
      }
      if (isFirstChapter) return "chapter_1";
      if (isFinalChapter) return "chapter_final";
      return "chapter_middle";
    })();

    // Kort lista med tidigare händelser (inte hela sagan)
    const compactHistory = previousChapters
      .slice(-3)
      .map((txt, idx) => {
        const chapterNo = previousChapters.length - (previousChapters.length - 1 - idx);
        return `Kapitel ${chapterNo}: ${shorten(txt, 320)}`;
      })
      .join("\n\n");

    const userPromptParts = [
      `Barnets idé / prompt: "${promptRaw}"`,
      ``,
      `Hjälte: ${heroName}`,
      `Åldersband: ${ageKey} år`,
      `Längdpreset: ${String(lengthPreset || "lagom")}`,
      `Storyläge: ${storyMode}`,
      storyMode === "chapter_book"
        ? `Detta är kapitel ${chapterIndex} i en kapitelbok (sikta på totalt ca ${totalChapters} kapitel).`
        : `Detta är en fristående saga (single_story).`,
      ``,
      storyMode === "chapter_book"
        ? `Tidigare i boken (sammanfattning): ${
            previousSummary
              ? shorten(previousSummary, 420)
              : "Ingen sammanfattning sparad ännu – anta att detta är början."
          }`
        : null,
      storyMode === "chapter_book" && previousChapters.length
        ? `Några viktiga saker som redan hänt:\n${compactHistory || "- inga sparade kapitel ännu"}`
        : null,
      ``,
      `Kapitelroll just nu: ${chapterRole}.`,
      chapterRole === "chapter_1"
        ? `Kapitel 1 ska börja lugnt i vardagen – plats, tid och enkel aktivitet – INNAN magi/äventyr startar. Efter vardagsstarten ska barnets idé gradvis ta över.`
        : null,
      chapterRole === "chapter_middle"
        ? `Detta är ett MITTENKAPITEL i en pågående bok. Du får INTE starta om historien med en helt ny vardag eller ett helt nytt huvudäventyr. Fortsätt där föregående kapitel slutade, med samma huvudproblem, samma hjälte (${heroName}) och samma kärnmiljö. Visa ett nytt hinder eller delmål, och avsluta gärna med en mjuk cliffhanger.`
        : null,
      chapterRole === "chapter_final"
        ? `Detta är ett SLUTKAPITEL. Fortsätt direkt efter föregående händelser. Knyt ihop de viktigaste trådarna och lös huvudkonflikten tydligt och barnvänligt. Introducera inte stora nya karaktärer eller helt nya problem. Avsluta lugnt, varmt och hoppfullt – men utan moraliska predikningar.`
        : null,
      storyMode === "chapter_book" && !isFirstChapter
        ? `VIKTIGT: Du får inte glömma hjälten ${heroName}. Använd samma namn genom hela boken och låt andra karaktärer fortsätta känna igen hen.`
        : `VIKTIGT: Om barnet har gett ett namn ska hjälten heta ${heroName} genom hela sagan – byt inte till neutrala namn som "vännen" eller liknande.`,
      ``,
      lengthInstruction,
      ``,
      `VIKTIGT: Skriv bara själva berättelsen i löpande text. Inga rubriker, inga punktlistor, inga "Lärdomar".`
    ];

    const userPrompt = userPromptParts.filter(Boolean).join("\n");

    // ------------------------------------------------------
    // OpenAI-anrop
    // ------------------------------------------------------

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

function getAllowedOrigin(env) {
  return (
    env.KIDSBM_ALLOWED_ORIGIN ||
    env.KIDSBM_ALLOWED_ORIGIN_DEV ||
    env.KIDSBM_ALLOWED_ORIGIN_LOCAL ||
    env.KIDSBM_ALLOWED_ORIGIN_PREVIEW ||
    env.KIDSBM_ALLOWED_ORIGIN_PROD ||
    env.KIDSBM_ALLOWED_ORIGIN_KIDS ||
    env.KIDSBM_ALLOWED_ORIGIN_BN ||
    env.KIDSBM_ALLOWED_ORIGIN_KIDSBM ||
    "*"
  );
}

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
            "Skriv på ett lite mer utvecklat sätt för 9–10 år. Mer detaljer, mer dialog, men fortfarande tydligt och tryggt.",
          baseTokens: 1400
        };
      case "11-12":
        return {
          baseInstr:
            "Skriv med mer djup och tempo som passar 11–12 år. Mer känslor, mer detaljerade scener och ibland lite humor.",
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
      : " Längden kan vara mittemellan – inte för kort, inte för lång.");

  return { lengthInstruction, maxTokens };
}

function buildSystemPrompt_BNKids(ageKey) {
  // Bas + Focus Lock + Flow + Kapitelstruktur + Anti-moral
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
- 13–15: något mognare, men fortfarande barnvänligt och utan grafiskt våld eller sex.

### BN-FLOW LAYER (din stil)
- Börja aldrig direkt med barnets prompt.
- Kapitel och sagor ska börja i vardagen: plats, tid, enkel aktivitet, stämning.
- Ge 4–8 meningar startscen innan magi/äventyr eller huvudproblemet dyker upp.
- Variera miljöer och objekt: använd inte alltid ekar, skattkartor, kistor, speglar eller "en röst bakom dem".
- "En röst bakom sig" eller liknande billiga skräcktriggers är förbjudna.
- Använd dialog naturligt, men inte i varje mening.
- Variera meningslängd. Blanda korta och längre meningar.

### MORAL & TON
- Visa känslor och värden genom handling, val och dialog — inte genom predikande meningar.
- Undvik fraser som: "det viktiga är att tro på sig själv", "du måste vara modig", "det viktigaste är vänskap".
- Avslut får gärna vara varma och hoppfulla, men utan att skriva ut moralen rakt ut.
- Ingen romantik för 7–9. För 10–12 kan oskyldiga crush-känslor förekomma om barnet antyder det, men håll dem subtila och barnvänliga.

### KAPITELBOKSLÄGE
När du skriver en kapitelbok:
- Kapitel 1: introducera vardagen, huvudpersonen, miljön och det första fröet till huvudproblemet. Lugn start, öka spänningen mot slutet av kapitlet.
- Mittenkapitel: fortsätt utforska samma huvudmål. Visa hinder, framsteg och små överraskningar. Max en enkel sidotråd.
- Slutkapitel: knyt ihop de viktigaste trådarna, lös huvudkonflikten tydligt och barnvänligt. Introducera inte stora nya karaktärer eller nya huvudproblem.
- Ge gärna en mjuk cliffhanger i mittenkapitel, men inget brutalt avbrott.

### KONTINUITET
- Karaktärer får inte byta namn, kön eller personlighet utan förklaring.
- Viktiga föremål (t.ex. draken, dörren, hissen, den magiska boken) ska användas konsekvent.
- Om tidigare sammanfattning eller kapitelbeskrivningar finns, ska de följas lojalt.

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
