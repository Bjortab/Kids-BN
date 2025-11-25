// functions/generate.js
// Pages Function: POST /api/generate
// BN-KIDS GC v6.0 – fokus på:
// - Stabil kapitelmotor (fortsätter samma berättelse, även med samma prompt)
// - Mindre moral-floskler
// - Mindre repetitiva solstrålar / standardscener
// - Bättre kapitelkänsla (1 / mitten / final)
// - Åldersanpassad temperatur (7–8 lugnare, 13–15 friare)

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
    // Förberedd historik / sammanfattning
    // ------------------------------------------------------
    const previousSummary =
      worldState.previousSummary ||
      worldState.summary ||
      "";

    const previousChapters = Array.isArray(worldState.previousChapters)
      ? worldState.previousChapters
      : [];

    const lastChapterFull =
      previousChapters.length > 0
        ? String(previousChapters[previousChapters.length - 1] || "")
        : "";

    // Ta de sista meningarna från förra kapitlet som extra ankare
    let lastChapterEnding = "";
    if (lastChapterFull) {
      const sentences = lastChapterFull
        .replace(/\s+/g, " ")
        .split(/(?<=[.!?])\s+/)
        .filter(Boolean);
      const tail = sentences.slice(-3).join(" ");
      lastChapterEnding = shorten(tail, 260);
    }

    const isFirstChapter = chapterIndex <= 1;
    const isFinalChapter = chapterIndex >= totalChapters - 1; // sista 1–2 kapitel = final-ton

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
      .map((txt, idx, arr) => {
        const num = previousChapters.length - arr.length + idx + 1;
        return `Kapitel ${num}: ${shorten(txt, 320)}`;
      })
      .join("\n\n");

    // ------------------------------------------------------
    // BN-KIDS SYSTEMPROMPT – Core + Flow + Kapitel
    // ------------------------------------------------------
    const systemPrompt = buildSystemPrompt_BNKids(ageKey);

    // ------------------------------------------------------
    // USERPROMPT – barnets idé + worldstate + kapitelroll
    // ------------------------------------------------------
    const userPromptParts = [
      `Barnets idé / prompt: "${promptRaw}"`,

      "",
      `Hjälte: ${heroName}`,
      `Åldersband: ${ageKey} år`,
      `Längdspreset: ${lengthPreset}`,
      `Storyläge: ${storyMode}`,
      storyMode === "chapter_book"
        ? `Detta är kapitel ${chapterIndex} i en *sammanhängande* kapitelbok (totalt ungefär ${totalChapters} kapitel).`
        : `Detta är en fristående saga (single_story).`,

      "",
      storyMode === "chapter_book"
        ? `Boken är EN enda berättelse. Även om barnets prompt är samma flera kapitel får du ALDRIG börja om från början – du ska alltid fortsätta där tidigare kapitel slutade.`
        : null,

      storyMode === "chapter_book"
        ? `Sammanfattning av vad som hänt hittills: ${
            previousSummary
              ? shorten(previousSummary, 420)
              : "Detta är början – inga tidigare händelser."
          }`
        : null,

      storyMode === "chapter_book" && previousChapters.length
        ? `Några viktiga saker som redan hänt:\n${compactHistory || "- inga sparade kapitel ännu"}`
        : null,

      storyMode === "chapter_book" && lastChapterEnding
        ? `Så här SLUTADE förra kapitlet (ankare, fortsätt direkt härifrån): ${lastChapterEnding}`
        : null,

      "",
      `Kapitelroll just nu: ${chapterRole}.`,

      chapterRole === "chapter_1"
        ? `Kapitel 1 ska börja i vardagen: plats, tid, enkel aktivitet, lite stämning. Sedan ska barnets idé gradvis ta över och skapa första gnistan till huvudproblemet. Ingen hård cliffhanger behövs – bara en mjuk känsla av att något är på gång.`
        : null,

      chapterRole === "chapter_middle"
        ? `Detta är ett MITTENKAPITEL. Du får INTE starta en ny berättelse. Fortsätt från där förra kapitlet slutade, med samma huvudproblem, samma huvudkaraktärer och samma magiska objekt. Visa ett tydligt delmål eller hinder på vägen. Du får gärna avsluta med lite nyfikenhet, men du behöver inte ha en cliffhanger varje gång.`
        : null,

      chapterRole === "chapter_final"
        ? `Detta är ett SLUTKAPITEL. Fortsätt från tidigare kapitel och knyt ihop de viktigaste trådarna. Lös huvudkonflikten tydligt och barnvänligt. Avsluta lugnt, varmt och hoppfullt – men utan att skriva ut moralen rakt ut. Inga nya stora karaktärer nu.`
        : null,

      storyMode === "single_story"
        ? `Detta är en fristående saga. Följ barnets idé noga, men skapa ändå en tydlig start (vardag), mitt (problem/äventyr) och slut (lösning, lugn avrundning utan skrivna moralkakor).`
        : null,

      "",
      lengthInstruction,

      "",
      `VIKTIGT: Skriv bara själva berättelsen i löpande text. Inga rubriker, inga punktlistor, inga "Lärdomar".`
    ];

    const userPrompt = userPromptParts.filter(Boolean).join("\n");

    // ------------------------------------------------------
    // OpenAI-anrop
    // ------------------------------------------------------

    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    // Åldersanpassad temperatur (lägre = mer stabil)
    const temperature = (() => {
      switch (ageKey) {
        case "7-8":
          return 0.6;
        case "9-10":
          return 0.65;
        case "11-12":
          return 0.7;
        case "13-15":
          return 0.75;
        default:
          return 0.7;
      }
    })();

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

    const data = await res.json();
    const story =
      data.choices?.[0]?.message?.content?.trim() ||
      "";

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
  // Bas + Focus Lock + Flow + Kapitelstruktur + Anti-moral + Anti-repeat
  return `
Du är BN-Kids berättelsemotor. Din uppgift är att skriva barnanpassade sagor och kapitelböcker på svenska.

### FOKUS & GENRE
- Följ alltid barnets prompt och tema noggrant.
- Byt aldrig genre eller huvudtema på egen hand.
- Om barnet nämner ett yrke (t.ex. detektiv) ska berättelsen kretsa kring det yrket.
- Om barnet nämner ett viktigt objekt (t.ex. en magisk dörr, drakarnas land, en hemlig hiss) ska objektet vara centralt tills konflikten är löst.
- Undvik mörker/skräck, hotfulla skuggor och monster om barnet inte specifikt ber om det.

### ÅLDERSBAND (${ageKey})
Anpassa språk, tempo och komplexitet efter åldern:
- 7–8: enklare meningar, tydliga känslor, få karaktärer, inga subplots.
- 9–10: lite mer detaljer, lite mer spänning, max en enkel sidotråd.
- 11–12: mer djup, mer dialog, mer avancerade känslor, fortfarande tryggt.
- 13–15: något mognare, men fortfarande barnvänligt och utan grafiskt våld/sex.

### BN-FLOW LAYER (din stil)
- Börja aldrig direkt med barnets prompt.
- Kapitel och sagor ska börja i vardagen: plats, tid, enkel aktivitet, stämning.
- Ge 4–8 meningar startscen innan magi/äventyr eller huvudproblemet dyker upp.
- Variera miljöer och objekt: använd inte alltid samma träd (t.ex. ekar), skattkartor, kistor, speglar eller "en röst bakom dem".
- "En röst bakom sig" eller liknande billiga skräcktriggers är förbjudna.
- Variera väder, ljus och miljö – använd inte samma formulering om solen eller ljusstrålar i varje berättelse.
- Använd dialog naturligt, men inte i varje mening.
- Variera meningslängd. Blanda korta och längre meningar.

### MORAL & TON
- Visa känslor och värden genom handling, val och dialog — inte genom predikande meningar.
- Undvik uttryck som: "det viktiga är att tro på sig själv", "du måste vara modig", "det viktigaste är vänskap", "det som betyder mest är att vara snäll".
- Skriv aldrig en avslutande "lärdom" eller moralkaka.
- Avslut får gärna vara varma och hoppfulla, men utan att skriva ut moralen rakt ut.
- Ingen romantik för 7–9. För 10–12 kan oskyldiga crush-känslor förekomma om barnet antyder det, men håll dem subtila och barnvänliga.

### KAPITELBOKSLÄGE
När du skriver en kapitelbok:
- Kapitel 1: introducera vardagen, huvudpersonen, miljön och det första fröet till huvudproblemet. Lugn start, öka spänningen mot slutet av kapitlet.
- Mittenkapitel: fortsätt utforska samma huvudmål. Visa hinder, framsteg och små överraskningar. Max en enkel sidotråd. Du får ibland avsluta med lite nyfikenhet, men inte brutala cliffhangers i varje kapitel.
- Slutkapitel: knyt ihop de viktigaste trådarna, lös huvudkonflikten tydligt och barnvänligt. Introducera inte stora nya karaktärer eller nya huvudproblem.
- Kapitel får inte kännas som separata sagor – de ska alltid fortsätta samma berättelse.

### KONTINUITET
- Du får ALDRIG börja om berättelsen i ett senare kapitel.
- Alla kapitel efter det första måste kännas som en fortsättning på samma bok.
- Karaktärer får inte byta namn, kön eller personlighet utan tydlig förklaring.
- Introducera inte helt nya viktiga huvudkaraktärer efter kapitel 2 om det inte är tydligt kopplat till tidigare händelser.
- Viktiga föremål (t.ex. draken, dörren, hissen, den magiska boken, den magiska hatten) ska användas konsekvent.
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
