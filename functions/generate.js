// functions/generate.js
// Pages Function: POST /api/generate
//
// BN-KIDS GC v6.4 – fokus på:
// - Stabil kapitelkänsla (ingen omstart när prompten är samma)
// - Väver in ny prompt utan att starta om boken
// - Mindre moralkake-floskler
// - Mindre "ekar / kistor / kartor / en röst bakom sig"
// - Författarton mer lik "Björn-exemplen"
// - Respekt för worldState (previousChapters, previousSummary, last_prompt, _userPrompt)

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

    if (!promptRaw && !worldState._userPrompt && !worldState.last_prompt) {
      return json(
        { ok: false, error: "Barnets idé/prompt saknas." },
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

    // -------------------------------
    // Normalisera ålder + längd
    // -------------------------------
    const ageKey = normalizeAge(ageGroupRaw);
    const { lengthInstruction, maxTokens } = getLengthInstructionAndTokens(
      ageKey,
      lengthPreset
    );

    // -------------------------------
    // worldState-baserad FLE-info
    // -------------------------------
    const previousSummary =
      worldState.previousSummary ||
      worldState.summary ||
      "";

    const previousChapters = Array.isArray(worldState.previousChapters)
      ? worldState.previousChapters
      : [];

    const lastPrompt = (worldState.last_prompt || "").trim();
    const userPromptFromState = (worldState._userPrompt || "").trim();
    const effectivePrompt = userPromptFromState || promptRaw || lastPrompt || "";

    const isNewPrompt =
      effectivePrompt &&
      lastPrompt &&
      effectivePrompt !== lastPrompt;

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

    // Kompakt historik: de 2–3 senaste kapitlen
    const compactHistory = previousChapters
      .slice(-3)
      .map((txt, idx, arr) => {
        const realIndex =
          previousChapters.length - arr.length + idx + 1;
        return `Kapitel ${realIndex}: ${shorten(txt, 280)}`;
      })
      .join("\n\n");

    // -------------------------------
    // Systemprompt (stor hjärna)
    // -------------------------------
    const systemPrompt = buildSystemPrompt_BNKids_v64(ageKey);

    // -------------------------------
    // Userprompt (konkret uppdrag)
    // -------------------------------
    const userLines = [];

    userLines.push(`Barnets grundidé (ursprunglig prompt eller tidigaste tanke): "${lastPrompt || effectivePrompt}"`);

    if (isNewPrompt) {
      userLines.push("");
      userLines.push(
        `Nytt tillägg från barnet för detta kapitel (ska VÄVAS IN utan att starta om historien): "${effectivePrompt}"`
      );
    } else {
      userLines.push("");
      userLines.push(
        "Inga nya önskemål i detta kapitel: fortsätt direkt där förra kapitlet slutade, utan omstart."
      );
    }

    userLines.push("");
    userLines.push(`Hjälte: ${heroName}`);
    userLines.push(`Åldersband: ${ageKey} år`);
    userLines.push(`Längdpreset: ${lengthPreset}`);
    userLines.push(`Storyläge: ${storyMode}`);
    if (storyMode === "chapter_book") {
      userLines.push(
        `Detta är kapitel ${chapterIndex} av en kapitelbok (planerat ca ${totalChapters} kapitel).`
      );
    } else {
      userLines.push("Detta är en fristående saga (single_story).");
    }

    userLines.push("");
    if (storyMode === "chapter_book") {
      if (previousSummary) {
        userLines.push(
          "Kort sammanfattning av vad som hänt tidigare i boken:"
        );
        userLines.push(shorten(previousSummary, 420));
      } else if (previousChapters.length > 0) {
        userLines.push(
          "Kort sammanfattning saknas, men det finns tidigare kapitel. Här är några korta utdrag:"
        );
        userLines.push(compactHistory || "- (inga sparade utdrag)");
      } else {
        userLines.push(
          "Inga tidigare kapitel – anta att detta är starten på berättelsen."
        );
      }
    }

    if (storyMode === "chapter_book" && previousChapters.length > 0) {
      userLines.push("");
      userLines.push("Några viktiga händelser att vara konsekvent med:");
      userLines.push(compactHistory || "- (inga sparade utdrag)");
    }

    userLines.push("");
    userLines.push(`Kapitelroll just nu: ${chapterRole}.`);

    if (chapterRole === "chapter_1") {
      userLines.push(
        "Kapitel 1 ska börja i vardagen (plats, tid, enkel aktivitet) innan barnets idé tar över."
      );
      userLines.push(
        "Du får INTE börja kapitlet med att bara upprepa barnets prompt rakt av."
      );
    } else if (chapterRole === "chapter_middle") {
      userLines.push(
        "Detta är ett mittenkapitel. Du får absolut inte starta om historien."
      );
      userLines.push(
        "Fortsätt exakt efter slutet på föregående kapitel. Visa nya steg mot huvudmålet, hinder, små överraskningar."
      );
      userLines.push(
        "Avsluta gärna ibland med en liten krok, men inte varje gång och utan brutala avbrott."
      );
    } else if (chapterRole === "chapter_final") {
      userLines.push(
        "Detta är ett avslutande kapitel. Knyt ihop de viktigaste trådarna och lös huvudkonflikten tydligt."
      );
      userLines.push(
        "Introducera inte nya stora karaktärer eller helt nya problem. Inga moraliska predikningar i slutet."
      );
    } else if (chapterRole === "single_story") {
      userLines.push(
        "Detta är en fristående saga. Ge tydlig början, mitt och slut i samma text."
      );
    }

    userLines.push("");
    userLines.push(lengthInstruction);
    userLines.push("");
    userLines.push(
      "VIKTIGT: Skriv bara själva berättelsen i löpande text. Inga rubriker, inga punktlistor, inga 'Lärdomar:' och inga förklaringar."
    );

    const userPrompt = userLines.join("\n");

    // -------------------------------
    // OpenAI-anrop
    // -------------------------------
    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    const payload = {
      model,
      temperature: 0.8,
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
  if (s.includes("13") && s.includes("15")) return "13-15";

  // fallback: använd någorlunda mitten
  if (s.includes("7")) return "7-8";
  if (s.includes("8")) return "7-8";
  if (s.includes("9")) return "9-10";
  if (s.includes("10")) return "9-10";
  if (s.includes("11")) return "11-12";
  if (s.includes("12")) return "11-12";

  return "7-8";
}

function getLengthInstructionAndTokens(ageKey, lengthPreset) {
  const lp = String(lengthPreset || "").toLowerCase();

  const base = (() => {
    switch (ageKey) {
      case "7-8":
        return {
          baseInstr:
            "Skriv på ett enkelt, tydligt och tryggt sätt som passar 7–8 år. Korta meningar, tydliga känslor, få karaktärer.",
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
            "Skriv med mer djup och tempo som passar 11–12 år. Mer känslor, dialog och miljöbeskrivningar.",
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
      ? " Denna text ska vara kortare än normalt."
      : lp.includes("lång")
      ? " Denna text får gärna vara längre än normalt."
      : " Längden kan vara mittemellan – inte för kort, inte för lång.");

  return { lengthInstruction, maxTokens };
}

function buildSystemPrompt_BNKids_v64(ageKey) {
  // Bas + Focus Lock + Flow + Kapitelstruktur + Anti-moral + Anti-repeat
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
- 7–8: enkla meningar, tydliga känslor, få karaktärer, inga subplots.
- 9–10: lite mer detaljer, lite mer spänning, max en enkel sidotråd.
- 11–12: mer djup, mer dialog, mer avancerade känslor, fortfarande tryggt.
- 13–15: något mognare, men fortfarande barnvänligt och utan grafiskt våld/sex.

### BN-FLOW LAYER (din stil)
- Börja inte med att upprepa barnets prompt ordagrant.
- Kapitel ska kännas som litterära scener, inte som punktlistor.
- Kapitel i en kapitelbok ska fortsätta berättelsen – inte starta om samma scenario.
- Använd vardagsscener med måtta: de ska kännas levande, inte som upprepade mallar.
- Variera miljöer och objekt: använd inte alltid ekar, skattkartor, kistor, speglar eller "en röst bakom sig".
- Frasen "en röst bakom sig" eller liknande billiga skräcktriggers är förbjudna.
- Undvik att upprepa samma meningar eller känslor om och om igen (t.ex. "han kände hur hjärtat slog snabbare" i varje kapitel).
- Använd dialog naturligt, men inte i varje mening.

### MORAL & TON
- Visa känslor och värden genom handling, val och dialog — inte genom predikande meningar.
- Undvik fraser som: "det viktiga är att tro på sig själv", "du måste vara modig", "det viktigaste är vänskap".
- Avslut får gärna vara varma och hoppfulla, men utan att skriva ut moralen rakt ut.
- Ingen romantik för 7–9. För 9–10 och 11–12 kan oskyldiga crush-känslor förekomma om barnet antyder det, men håll dem subtila och barnvänliga.

### KAPITELBOKSLÄGE
När du skriver en kapitelbok:
- Kapitel 1: introducera vardagen, huvudpersonen, miljön och ett första frö till huvudproblemet. Lugn start, öka spänningen mot slutet.
- Mittenkapitel: fortsätt utforska samma huvudmål. Visa hinder, framsteg och små överraskningar. Max en enkel sidotråd.
- Slutkapitel: knyt ihop de viktigaste trådarna, lös huvudkonflikten tydligt och barnvänligt. Introducera inte stora nya karaktärer eller nya huvudproblem.
- Du får ibland avsluta med en liten cliffhanger, men inte i varje kapitel, och cliffhangern ska gå att plocka upp naturligt nästa gång.

### KONTINUITET
- Du får INTE starta om berättelsen om det redan finns tidigare kapitel.
- Karaktärer får inte byta namn, kön eller personlighet utan förklaring.
- Viktiga föremål (t.ex. draken, dörren, hissen, den magiska boken) ska användas konsekvent.
- Händelser i det nya kapitlet måste kännas logiskt kopplade till det som hänt innan.

### UTDATA
- Skriv endast berättelsetexten.
- Inga rubriker som "Kapitel 1" om inte barnet tydligt vill ha det.
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
