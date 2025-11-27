// functions/generate.js
// Pages Function: POST /api/generate
//
// BN-KIDS GC v9.0
// - Enkel, stabil version utan ”engine-läge-trix”
// - Mindre floskler (förbjuder klassiska öppningar och klyschor)
// - Starkare kapitelkontinuitet: fortsätt där förra kapitlet slutade

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

    const promptChanged = !!body.promptChanged;

    if (!promptRaw && !worldState?.last_prompt) {
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
    // Ålder + längd → instr + max_tokens
    // ------------------------------------------------------
    const ageKey = normalizeAge(ageGroupRaw);
    const { lengthInstruction, maxTokens } = getLengthInstructionAndTokens(
      ageKey,
      lengthPreset
    );

    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    // ------------------------------------------------------
    // Kapitelroll & historik
    // ------------------------------------------------------
    const userPromptStr = String(promptRaw || "");
    const userWantsEnd = /avslut|knyt ihop|slut(et)?/i.test(userPromptStr);

    let chapterRole;
    if (!storyMode || storyMode === "single_story") {
      chapterRole = "single_story";
    } else if (chapterIndex <= 1) {
      chapterRole = "chapter_1";
    } else if (userWantsEnd || chapterIndex >= totalChapters) {
      chapterRole = "chapter_final";
    } else {
      chapterRole = "chapter_middle";
    }

    const previousSummary =
      worldState.previousSummary ||
      worldState.summary ||
      "";

    const previousChapters = Array.isArray(worldState.previousChapters)
      ? worldState.previousChapters
      : [];

    const compactHistory = previousChapters
      .map((txt, idx) => `Kapitel ${idx + 1}: ${shorten(txt, 320)}`)
      .slice(-3)
      .join("\n\n");

    const lastChapterText =
      previousChapters.length > 0
        ? String(previousChapters[previousChapters.length - 1] || "")
        : "";

    // Sista biten av förra kapitlet som ankare
    const lastChapterEnding = lastChapterText
      ? shorten(lastChapterText.slice(-400), 400)
      : "";

    const effectivePrompt =
      userPromptStr && userPromptStr.trim()
        ? userPromptStr.trim()
        : (worldState._userPrompt ||
           worldState.last_prompt ||
           "");

    // ------------------------------------------------------
    // SYSTEMPROMPT – BN-Kids stil + anti-floskler
    // ------------------------------------------------------
    const systemPrompt = buildSystemPrompt_BNKids_v9(ageKey);

    // ------------------------------------------------------
    // USERPROMPT – barnets idé + worldstate + kapitelroll
    // ------------------------------------------------------
    const lines = [];

    // Barnets idé
    lines.push(
      `Barnets idé / prompt just nu: "${effectivePrompt}"`
    );
    lines.push("");
    lines.push(`Hjälte: ${heroName}`);
    lines.push(`Åldersband: ${ageKey} år`);
    lines.push(`Längdpreset: ${lengthPreset}`);
    lines.push(`Storyläge: ${storyMode}`);
    if (storyMode === "chapter_book") {
      lines.push(
        `Detta är kapitel ${chapterIndex} i en kapitelbok (totalt ca ${totalChapters} kapitel).`
      );
    } else {
      lines.push("Detta är en fristående saga (single_story).");
    }
    lines.push("");

    // Historik / sammanfattning
    if (storyMode === "chapter_book") {
      if (previousSummary) {
        lines.push(
          "Kort sammanfattning av vad som hänt hittills i boken:"
        );
        lines.push(shorten(previousSummary, 420));
        lines.push("");
      } else if (previousChapters.length) {
        lines.push(
          "Tidigare kapitel finns, men ingen separat sammanfattning är sparad. Här är några viktiga saker som hänt:"
        );
        lines.push(compactHistory || "- inga sparade kapitel ännu");
        lines.push("");
      } else {
        lines.push(
          "Detta verkar vara början på boken. Inga tidigare kapitel är sparade."
        );
        lines.push("");
      }
    }

    // Extra ankare: slutet på förra kapitlet
    if (storyMode === "chapter_book" && chapterIndex > 1 && lastChapterEnding) {
      lines.push("Här är slutet på det senaste kapitlet. Du ska fortsätta direkt efter detta, utan att starta om:");
      lines.push(lastChapterEnding);
      lines.push("");
    }

    // Kapitelroll-instruktioner
    lines.push(`Kapitelroll just nu: ${chapterRole}.`);

    if (chapterRole === "chapter_1" && storyMode === "chapter_book") {
      lines.push(
        "Kapitel 1 ska introducera vardagen, huvudpersonen och första fröet till problemet eller äventyret."
      );
      lines.push(
        "Du får gärna börja lugnt, men variera inledningen och undvik klichéer som 'Det var en solig dag' eller 'I den lilla byn'."
      );
    } else if (chapterRole === "chapter_middle" && storyMode === "chapter_book") {
      lines.push(
        "Detta är ett mittenkapitel. Fortsätt samma huvudmål som tidigare, med ett tydligt hinder eller delmål."
      );
      lines.push(
        "Starta INTE om berättelsen. Hoppa inte tillbaka i tiden och skriv inte en ny 'det var en solig eftermiddag'-scen."
      );
      lines.push(
        "Fortsätt där förra kapitlet slutade, i samma situation, så att det känns som ett naturligt nästa steg."
      );
    } else if (chapterRole === "chapter_final" && storyMode === "chapter_book") {
      lines.push(
        "Detta är ett avslutande kapitel i samma bok, med samma karaktärer och samma huvudmål."
      );
      lines.push(
        "Introducera inte stora nya karaktärer eller ett helt nytt huvudproblem."
      );
      lines.push(
        "Knyt ihop de viktigaste trådarna och lös huvudkonflikten tydligt och barnvänligt."
      );
    }

    lines.push("");

    // promptChanged → hur modellen ska tolka barnets nya önskan
    if (storyMode === "chapter_book" && chapterIndex > 1) {
      if (promptChanged) {
        lines.push(
          "Viktigt: Barnet har ändrat eller lagt till en ny önskan för JUST DETTA KAPITEL."
        );
        lines.push(
          "Fortsätt samma bok och samma pågående situation, men låt den nya önskan styra vad som händer nu."
        );
      } else {
        lines.push(
          "Viktigt: Barnet har INTE ändrat prompten sedan förra kapitlet."
        );
        lines.push(
          "Fortsätt direkt där förra kapitlet slutade. Starta inte om med en ny dag, ny koja eller ny 'första scen'."
        );
      }
      lines.push("");
    }

    // Längdinstruktion
    lines.push(lengthInstruction);
    lines.push("");
    lines.push(
      "VIKTIGT: Svara enbart med själva berättelsen i löpande text. Inga rubriker, inga punktlistor, inga 'Lärdomar:' och inga förklaringar om varför du skrev som du gjorde."
    );

    const userPrompt = lines.join("\n");

    // ------------------------------------------------------
    // OpenAI-anrop
    // ------------------------------------------------------
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
  // Matcha våra dropdown-värden: 7-8, 9-10, 11-12, 13-14, 15
  if (s.includes("7") && s.includes("8")) return "7-8";
  if (s.includes("9") && s.includes("10")) return "9-10";
  if (s.includes("11") && s.includes("12")) return "11-12";
  if (s.includes("13") || s.includes("14") || s.includes("15")) return "13-15";
  return "9-10";
}

function getLengthInstructionAndTokens(ageKey, lengthPreset) {
  const lp = String(lengthPreset || "").toLowerCase();

  const base = (() => {
    switch (ageKey) {
      case "7-8":
        return {
          baseInstr:
            "Skriv på ett enkelt, tydligt och tryggt sätt som passar 7–8 år. Korta meningar, tydliga känslor, få karaktärer, inga subplots.",
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
            "Skriv för yngre tonåringar 13–15. Mogen men trygg ton, mer komplex handling, men fortfarande barnvänligt.",
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
      ? " Denna saga/kapitel ska vara kortare än normalt."
      : lp.includes("lång")
      ? " Detta kapitel får gärna vara längre än normalt."
      : " Längden kan vara mittemellan – inte för kort, inte för lång.");

  return { lengthInstruction, maxTokens };
}

// Ny systemprompt – utan tvingad ”börja i vardagen”-mall och med anti-floskler
function buildSystemPrompt_BNKids_v9(ageKey) {
  return `
Du är BN-Kids berättelsemotor. Du skriver barnanpassade sagor och kapitelböcker på svenska.

### FOKUS & GENRE
- Följ alltid barnets prompt och tema noggrant.
- Byt aldrig genre eller huvudtema på egen hand.
- Om barnet nämner ett yrke (t.ex. detektiv) ska berättelsen kretsa kring det yrket.
- Om barnet nämner ett viktigt objekt (t.ex. en magisk dörr, drakarnas land, en hemlig hiss) ska objektet vara centralt tills konflikten är löst.
- Undvik mörker/skräck, hotfulla skuggor och monster om barnet inte specifikt ber om det.

### ÅLDERSBAND (${ageKey})
Anpassa språk, tempo och komplexitet efter åldern:
- 7–8: enklare meningar, tydliga känslor, få karaktärer, inga subplots. Gåtor ska vara ovanliga – max EN enkel gåta i hela boken, inte en gåta i varje kapitel.
- 9–10: lite mer detaljer, lite mer spänning, max en enkel sidotråd.
- 11–12: mer djup, mer dialog, mer avancerade känslor, fortfarande tryggt.
- 13–15: något mognare, men fortfarande barnvänligt och utan grafiskt våld eller sex.

### STIL & VARIATION
- Variera hur berättelser börjar. Undvik klyschor som:
  - "Det var en solig dag"
  - "Det var en gång"
  - "I den lilla byn"
  - "Solen sken och fåglarna kvittrade"
  - "Deras hjärtan bultade av spänning"
  - "Under den stora eken"
- Du får gärna ha mysiga miljöer, men skriv dem på nya sätt varje gång.
- Använd dialog naturligt, men inte i varje mening.
- Variera meningslängd. Blanda korta och längre meningar.
- Hoppa inte plötsligt tillbaka i tiden utan tydlig förklaring.

### MORAL & TON
- Visa känslor och värden genom handling, val och dialog — inte genom predikande meningar.
- Undvik fraser som:
  - "det viktiga är att tro på sig själv"
  - "du måste vara modig"
  - "det viktigaste är vänskap"
  - "äventyret hade bara börjat"
- Avslut får gärna vara varma och hoppfulla, men utan att skriva ut moralen rakt ut.
- Ingen romantik för 7–8. För 9–10 och 11–12 kan oskyldiga crush-känslor förekomma om barnet antyder det, men håll dem subtila och barnvänliga.

### KAPITELBOKSLÄGE
När du skriver en kapitelbok:
- Kapitel 1: introducera på ett intressant sätt, men utan att alltid använda samma väder-/skogsklichéer.
- Mittenkapitel: fortsätt samma huvudmål, visa hinder, framsteg och överraskningar. Upprepa inte exakt samma scen (t.ex. samma koja, samma bro) utan orsak.
- Slutkapitel: knyt ihop de viktigaste trådarna, lös huvudkonflikten tydligt och barnvänligt. Introducera inte stora nya karaktärer eller nya huvudproblem.
- Ge gärna en mjuk cliffhanger i mittenkapitel, men inte i varje kapitel och aldrig i sista kapitlet.

### KONTINUITET
- Karaktärer får inte byta namn, kön eller personlighet utan förklaring.
- Viktiga föremål (t.ex. draken, dörren, hissen, den magiska boken) ska användas konsekvent.
- Följ noggrant den sammanfattning och det kapitelslut du får i instruktionen.
- Skriv fortsättningen så att det känns som samma pågående berättelse, inte som en ny fristående saga.

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
