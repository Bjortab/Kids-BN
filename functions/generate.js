// functions/generate.js
// Pages Function: POST /api/generate
// BN-KIDS GC v6.3
// - Förbättrad kapitelkänsla (8–12 kapitel)
// - Hårdare låsning till tidigare kapitel (ingen ”ny saga” mitt i boken)
// - Tydligare regler för hjälten vs. biroller (pappa/mamma m.fl.)
// - Mindre moral-snack och färre upprepade inledningar
// - Respekt för barnets prompt, hjälte och ålder

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

    // ------------------------------------------------------
    // WORLDSTATE / HISTORIK
    // ------------------------------------------------------
    const previousSummary =
      worldState.previousSummary ||
      worldState.summary ||
      "";

    const previousChapters = Array.isArray(worldState.previousChapters)
      ? worldState.previousChapters
      : [];

    const lastChapter =
      previousChapters.length > 0
        ? String(previousChapters[previousChapters.length - 1] || "")
        : "";

    const lastChapterSnippet = lastChapter
      ? shorten(lastChapter.slice(-400), 360)
      : "";

    const compactHistory = previousChapters
      .slice(-3)
      .map((txt, idx) => {
        const num = previousChapters.length - 2 + idx;
        return `Kapitel ${num}: ${shorten(txt, 260)}`;
      })
      .join("\n\n");

    const isFirstChapter = chapterIndex <= 1;
    const isFinalChapter = chapterIndex >= totalChapters - 1; // sista 1–2 kapitel får final-ton

    const chapterRole = (() => {
      if (!storyMode || storyMode === "single_story") {
        return "single_story";
      }
      if (isFirstChapter) return "chapter_1";
      if (isFinalChapter) return "chapter_final";
      return "chapter_middle";
    })();

    // ------------------------------------------------------
    // USERPROMPT – barnets idé + worldstate + kapitelroll
    // ------------------------------------------------------
    const userPromptParts = [
      `Barnets idé / prompt: "${promptRaw}"`,
      ``,
      `Hjälte: ${heroName}`,
      `Huvudpersonen/hjälten i berättelsen ska vara: ${heroName}.`,
      `Om andra personer nämns (t.ex. föräldrar, lärare, kompisar) ska de vara biroller och inte byta plats med hjälten.`,
      `Byt inte rollerna mellan hjälten och föräldrar eller andra vuxna, även om de nämns i prompten.`,
      `Åldersband: ${ageKey} år`,
      `Längdspreset: ${lengthPreset}`,
      `Storyläge: ${storyMode || "single_story"}`,
      storyMode === "chapter_book"
        ? `Detta är kapitel ${chapterIndex} av en kapitelbok (totalt ungefär ${totalChapters} kapitel).`
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
      storyMode === "chapter_book" && lastChapterSnippet
        ? `Föregående kapitel slutade ungefär så här:\n"${lastChapterSnippet}"\nFortsätt scenen där detta kapitel slutar. Starta inte en ny berättelse.`
        : null,
      ``,
      `Kapitelroll just nu: ${chapterRole}.`,
      chapterRole === "chapter_1"
        ? [
            `Kapitel 1 ska börja i vardagen, inte direkt i magi eller action.`,
            `Ge en tydlig startscen (plats, tid, enkel aktivitet i vardagen) och låt sedan barnets idé gradvis ta över.`,
            `Starta EN berättelse – skapa inget avslut i första kapitlet, bara en känsla av att äventyret precis har börjat.`
          ].join(" ")
        : null,
      chapterRole === "chapter_middle"
        ? [
            `Detta är ett mittenkapitel i en pågående bok.`,
            `Fortsätt EXAKT samma berättelse som i de tidigare kapitlen.`,
            `Du får INTE starta en ny saga eller introducera ett helt nytt huvudproblem.`,
            `Utgå från slutet på föregående kapitel (se citat ovan) och skriv vad som händer direkt efteråt.`,
            `Håll samma huvudpersoner, samma viktiga föremål och samma huvudmål.`,
            `Visa ett tydligt delmål eller hinder på vägen mot huvudmålet.`,
            `Avsluta gärna med en mjuk cliffhanger, men låt kapitlet kännas som en del av samma bok, inte som ett nytt äventyr.`
          ].join(" ")
        : null,
      chapterRole === "chapter_final"
        ? [
            `Detta är ett avslutande kapitel i en kapitelbok.`,
            `Fortsätt EXAKT samma berättelse – inga nya huvudproblem, inga nya huvudkaraktärer.`,
            `Utgå från slutet på föregående kapitel (se citat ovan) och lös huvudkonflikten på ett tydligt och barnvänligt sätt.`,
            `Avsluta lugnt, varmt och hoppfullt – utan att skriva ut moralen rakt ut.`,
            `Skriv ingen ny cliffhanger. Läsaren ska känna att boken är färdig, men med en härlig känsla av framtid.`
          ].join(" ")
        : null,
      ``,
      lengthInstruction,
      ``,
      `VIKTIGT:`,
      `- Skriv endast berättelsetext i löpande form.`,
      `- Starta inte en ny saga om detta inte är kapitel 1 eller en fristående single_story.`,
      `- Variera inledningarna. Använd inte samma formulering ("Det var en solig morgon..." osv) i varje kapitel.`,
      `- Djur ska bete sig rimligt (t.ex. hästar beter sig inte exakt som hundar).`,
      `- Inga rubriker, inga punktlistor, inga "Lärdomar:".`,
      `- Skriv inte meta-kommentarer om hur du följer instruktionerna.`
    ];

    const userPrompt = userPromptParts.filter(Boolean).join("\n");

    // ------------------------------------------------------
    // OpenAI-anrop
    // ------------------------------------------------------

    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    const payload = {
      model,
      temperature: 0.7, // lugnare för bättre konsistens
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: buildSystemPrompt_BNKids(ageKey) },
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
      ? " Denna saga ska vara kortare än normalt."
      : lp.includes("lång")
      ? " Denna saga får gärna vara längre än normalt."
      : " Längden kan vara mittemellan – inte för kort, inte för lång.");

  return { lengthInstruction, maxTokens };
}

function buildSystemPrompt_BNKids(ageKey) {
  return `
Du är BN-Kids berättelsemotor. Din uppgift är att skriva barnanpassade sagor och kapitelböcker på svenska.

### FOKUS & GENRE
- Följ alltid barnets prompt och tema noggrant.
- Byt aldrig genre eller huvudtema på egen hand.
- Om barnet nämner ett yrke (t.ex. detektiv) ska sagan kretsa kring det yrket.
- Om barnet nämner ett viktigt objekt (t.ex. en magisk dörr, drakarnas land, en hemlig hiss) ska objektet vara centralt tills konflikten är löst.
- Undvik mörker/skräck, hotfulla skuggor och monster om barnet inte specifikt ber om det.

### ÅLDERSBAND (${ageKey})
Anpassa språk, tempo och komplexitet efter åldern:
- 7–8: enklare meningar, tydliga känslor, få karaktärer, inga subplots.
- 9–10: lite mer detaljer, lite mer spänning, max en enkel sidotråd.
- 11–12: mer djup, mer dialog, mer avancerade känslor, fortfarande tryggt.
- 13–15: något mognare, men fortfarande barnvänligt och utan grafiskt våld eller sex.

### BN-FLOW (stil)
- Börja inte med att rabbla regler eller förklaringar. Gå direkt in i berättelsen.
- Kapitel och sagor ska ofta börja i vardagen: plats, tid, enkel aktivitet, stämning.
- Ge några meningar startscen innan magi/äventyr eller huvudproblemet dyker upp.
- Variera miljöer och objekt: använd inte alltid samma träd, samma gata, samma "sol genom fönstret".
- "En röst bakom sig" eller liknande billiga skräcktriggers ska användas mycket sparsamt.
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
- Mittenkapitel: fortsätt exakt samma huvudmål. Visa hinder, framsteg och små överraskningar. Ingen ny huvudkonflikt.
- Slutkapitel: knyt ihop de viktigaste trådarna, lös huvudkonflikten tydligt och barnvänligt. Introducera inte stora nya karaktärer eller nya huvudproblem.
- Ge gärna en mjuk cliffhanger i mittenkapitel, men inte i det sista kapitlet.

### KONTINUITET
- Karaktärer får inte byta namn, kön eller personlighet utan förklaring.
- Viktiga föremål (t.ex. draken, dörren, hissen, den magiska boken) ska användas konsekvent.
- Följ tidigare sammanfattningar och kapitelbeskrivningar lojalt.

### UTDATA
- Skriv endast berättelsetexten.
- Inga rubriker som "Kapitel 1" om inte användaren tydligt vill det.
- Inga punktlistor, inga "Lärdomar:", inga metakommentarer om hur du följer instruktionerna.
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
