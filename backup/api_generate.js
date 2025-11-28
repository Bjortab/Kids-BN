// functions/api/generate.js
// BN-KIDS — Cloudflare Pages Function: POST /api/generate
//
// GC v7.3.3 – fokus:
// - Behåller fungerande kapitelmotor från v7.3.2 (ingen ändrad logik för chapterIndex / previousChapters).
// - Förhindrar kapitelstart med "..." och avhuggna meningar.
// - Mittenkapitel: max 1–2 meningars kort påminnelse, sedan ny scen framåt.
// - Gåtor/rim/pussel ska vara konsekventa mellan kapitel (samma gåta tills den löses).
//
// Viktigt:
// - Frontend (ws_button.gc.js) skickar worldState + ev. chapterIndex,
//   men backend litar i första hand på worldState.previousChapters.length.

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

    // ------------------------------------------------------
    // Grunddata från body
    // ------------------------------------------------------
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

    let storyMode =
      body.storyMode ||
      body.story_mode ||
      (body.chapterIndex ? "chapter_book" : "single_story");

    const worldState = body.worldState || {};
    const promptChanged = !!body.promptChanged;

    const previousChapters = Array.isArray(worldState.previousChapters)
      ? worldState.previousChapters
      : [];

    const previousChaptersCount = previousChapters.length;

    const totalChapters =
      Number(body.totalChapters || worldState?.meta?.totalChapters) || 8;

    // ------------------------------------------------------
    // Robust kapitelIndex: räkna från historiken
    // ------------------------------------------------------
    let chapterIndexFromBody = Number(body.chapterIndex || 0);
    let chapterIndex;

    if (previousChaptersCount > 0) {
      // Om det finns historik: kapitel = antal tidigare + 1
      chapterIndex = previousChaptersCount + 1;
    } else if (chapterIndexFromBody > 0) {
      // Första kapitlet kan komma via body
      chapterIndex = chapterIndexFromBody;
    } else {
      chapterIndex = 1;
    }

    if (!storyMode || storyMode === "single_story") {
      storyMode = chapterIndex > 1 ? "chapter_book" : "single_story";
    }

    // Prompt får aldrig vara helt tom
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

    // ------------------------------------------------------
    // Kapitelroll: styr hur modellen ska bete sig
    // ------------------------------------------------------
    const userWantsEnd = /avslut|knyt ihop|slut(et)?/i.test(promptRaw || "");

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

    // ------------------------------------------------------
    // Historik från worldState
    // ------------------------------------------------------
    const previousSummary =
      worldState.previousSummary ||
      worldState.summary ||
      "";

    const compactHistory = previousChapters
      .map((txt, idx) => `Kapitel ${idx + 1}: ${shorten(txt, 320)}`)
      .slice(-3)
      .join("\n\n");

    const lastChapterText =
      previousChaptersCount > 0
        ? String(previousChapters[previousChaptersCount - 1] || "")
        : "";

    const lastScenePreview = lastChapterText
      ? shorten(lastChapterText.slice(-600), 320)
      : "";

    const effectivePrompt =
      promptRaw && String(promptRaw).trim()
        ? String(promptRaw).trim()
        : (worldState._userPrompt ||
           worldState.last_prompt ||
           "");

    // ------------------------------------------------------
    // SYSTEMPROMPT – BN-Kids stil + regler
    // ------------------------------------------------------
    const systemPrompt = buildSystemPrompt_BNKids_v7(ageKey);

    // ------------------------------------------------------
    // USERPROMPT – barnets idé + worldstate + kapitelroll + promptChanged
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

    // Sammanfattning + historik
    if (storyMode === "chapter_book") {
      if (previousSummary) {
        lines.push(
          "Kort sammanfattning av vad som hänt hittills i boken:"
        );
        lines.push(shorten(previousSummary, 420));
        lines.push("");
      } else if (previousChaptersCount > 0) {
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

    if (storyMode === "chapter_book" && previousChaptersCount > 0 && lastScenePreview) {
      lines.push(
        "Här är slutet av förra kapitlet (den scen du ska fortsätta direkt efter):"
      );
      lines.push(lastScenePreview);
      lines.push("");
    }

    // Kapitelroll-instruktioner
    lines.push(`Kapitelroll just nu: ${chapterRole}.`);

    if (chapterRole === "chapter_1" && storyMode === "chapter_book") {
      lines.push(
        "Kapitel 1 ska börja i vardagen: visa plats, tid och en enkel aktivitet innan magi/äventyr eller huvudproblemet dyker upp."
      );
      lines.push(
        "Barnets idé ska vävas in gradvis – inte allt på första meningen."
      );
    } else if (chapterRole === "chapter_middle" && storyMode === "chapter_book") {
      lines.push(
        "Detta är ett mittenkapitel. Fortsätt samma huvudmål som tidigare."
      );
      lines.push(
        "Börja precis där förra kapitlet slutade, men skriv en NY fullständig öppningsmening (inga '...' och inga avhuggna meningar)."
      );
      lines.push(
        "Du får ge högst 1–2 korta meningar som påminner om vad de håller på med nu, men hoppa sedan snabbt vidare in i en ny scen framåt i samma äventyr."
      );
      lines.push(
        "Skapa ett tydligt delmål eller hinder på vägen, men introducera inte en helt ny huvudkonflikt."
      );
      lines.push(
        "Upprepa inte exakt samma scen (t.ex. leta efter samma skatt på samma plats) utan tydlig orsak."
      );
    } else if (chapterRole === "chapter_final" && storyMode === "chapter_book") {
      lines.push(
        "Detta ska vara ett avslutande kapitel i samma bok, med samma karaktärer och samma huvudmål."
      );
      lines.push(
        "Du får INTE starta en ny berättelse eller hoppa till en helt ny plats som inte förberetts."
      );
      lines.push(
        "Knyt ihop de viktigaste trådarna och lös huvudkonflikten tydligt och barnvänligt."
      );
      lines.push(
        "Avsluta varmt och hoppfullt men utan moral-predikningar."
      );
    }

    lines.push("");

    // promptChanged → hur modellen ska tolka barnets nya önskan
    if (storyMode === "chapter_book" && chapterIndex > 1) {
      if (promptChanged) {
        lines.push(
          "Viktigt: Barnet har nu ändrat eller lagt till en ny önskan för JUST DETTA KAPITEL."
        );
        lines.push(
          "Du ska FORTSÄTTA samma bok, men låta denna nya önskan styra vad som händer nu."
        );
        lines.push(
          "Du får INTE börja om från början – allt som hänt i tidigare kapitel gäller fortfarande."
        );
      } else {
        lines.push(
          "Viktigt: Barnet har INTE ändrat prompten sedan förra kapitlet."
        );
        lines.push(
          "Fortsätt exakt där förra kapitlet slutade. Starta inte om, hoppa inte tillbaka och hitta inte på en ny huvudberättelse."
        );
        lines.push(
          "Ingen repetition av 'början på äventyret' – gå vidare framåt i samma story."
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
    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    const payload = {
      model,
      temperature: 0.7, // lite lägre för mindre random omstarter
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

    return json(
      {
        ok: true,
        story,
        debug: {
          chapterIndex,
          storyMode,
          ageKey,
          lengthPreset,
          totalChapters,
          previousChaptersCount,
          promptChanged,
          usedLastScene: !!lastScenePreview,
          lastScenePreview
        }
      },
      200,
      origin
    );
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
  // Matcha våra dropdown-värden: 7-8, 9-10, 11-12, 13-15
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
  if (lp.includes("kort") || lp.includes("short")) factor = 0.7;
  else if (lp.includes("lång") || lp.includes("long")) factor = 1.3;

  const maxTokens = Math.round(base.baseTokens * factor);

  const lengthInstruction =
    base.baseInstr +
    (lp.includes("kort") || lp.includes("short")
      ? " Denna saga/kapitel ska vara kortare än normalt."
      : lp.includes("lång") || lp.includes("long")
      ? " Detta kapitel får gärna vara längre än normalt."
      : " Längden kan vara mittemellan – inte för kort, inte för lång.");

  return { lengthInstruction, maxTokens };
}

function buildSystemPrompt_BNKids_v7(ageKey) {
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
- 7–8: enklare meningar, tydliga känslor, få karaktärer, inga subplots. Max EN enkel gåta i hela boken, inte en ny gåta i varje kapitel.
- 9–10: lite mer detaljer, lite mer spänning, max en enkel sidotråd.
- 11–12: mer djup, mer dialog, mer avancerade känslor, fortfarande tryggt.
- 13–15: något mognare, men fortfarande barnvänligt och utan grafiskt våld eller sex.

### BN-FLOW LAYER (din stil)
- Börja aldrig direkt med barnets prompt i första meningen.
- Kapitel och sagor ska börja i vardagen: plats, tid, enkel aktivitet, stämning.
- Ge 3–6 meningar startscen innan magi/äventyr eller huvudproblemet dyker upp.
- Börja ALDRIG ett kapitel med "..." eller en avhuggen, halv mening. Skriv alltid en ny, tydlig öppningsmening.
- I mittenkapitel får du bara ha en mycket kort påminnelse (max 1–2 meningar) om vad de håller på med nu – sedan ska scenen röra sig framåt.
- Variera miljöer och objekt: använd inte alltid samma träd, samma skattkartor, samma kistor eller samma "mystiska röst bakom ryggen".
- "En röst bakom sig" eller liknande billiga skräcktriggers är förbjudna.
- Använd dialog naturligt, men inte i varje mening.
- Variera meningslängd. Blanda korta och längre meningar.

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
- Kapitel 1: introducera vardagen, huvudpersonen, miljön och det första fröet till huvudproblemet. Lugn start, öka spänningen mot slutet av kapitlet.
- Mittenkapitel: fortsätt utforska samma huvudmål. Visa hinder, framsteg och små överraskningar. Max en enkel sidotråd. Upprepa inte samma scen utan tydlig orsak.
- Slutkapitel: knyt ihop de viktigaste trådarna, lös huvudkonflikten tydligt och barnvänligt. Introducera inte stora nya karaktärer eller nya huvudproblem.
- Ge gärna en mjuk cliffhanger i mittenkapitel, men inte i varje kapitel och aldrig i sista kapitlet.

### KONTINUITET
- Karaktärer får inte byta namn, kön eller personlighet utan förklaring.
- Viktiga föremål (t.ex. draken, dörren, hissen, den magiska boken) ska användas konsekvent.
- Om tidigare sammanfattning eller kapitelbeskrivningar finns, ska de följas lojalt.
- Om ett djur eller föremål redan definierats (t.ex. en kanin) får det inte plötsligt bli ett annat djur (t.ex. en hund) utan tydlig magisk förklaring.
- Om en gåta, ett rim eller ett pussel har introducerats ska det vara samma gåta i nästa kapitel tills den är löst. Ändra inte själva gåtan eller svaret utan tydlig förklaring.

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
