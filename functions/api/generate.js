// functions/api/generate.js
// BN-KIDS — Cloudflare Pages Function: POST /api/generate
//
// HARD MODE v1.0 (bygger vidare på v7.x som gav fungerande kapitel)
// ---------------------------------------------------------------
// Fokus:
// - Respektera kapitelmotorn i frontend (BNWorldState + ws_button.gc.js)
//   * VI RÄKNAR INTE OM chapterIndex HÄR
//   * VI LITAR PÅ body.chapterIndex + worldState.previousChapters
// - Hårdare regler för kapitelkontinuitet ("Hard Mode"):
//   * Fortsätt där förra kapitlet slutade (scen, plats, känsla)
//   * Byt inte huvudmål mitt i boken
//   * Ingen ny "början på sagan" i kapitel 2+
//   * Begränsa nya karaktärer och magiska saker
//   * Mindre floskler, mindre “det var en solig dag…” osv

const ENGINE_VERSION = "bn-kids-hardmode-v1.0";

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

    // ⚠️ Viktigt: vi rör INTE kapitelmotorn.
    // Vi använder bara det kapitelIndex som frontend skickar.
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
    // Historik från worldState
    // ------------------------------------------------------
    const previousSummary =
      worldState.previousSummary ||
      worldState.summary ||
      "";

    const previousChapters = Array.isArray(worldState.previousChapters)
      ? worldState.previousChapters
      : [];

    const previousChaptersCount = previousChapters.length;

    const compactHistory = previousChapters
      .map((txt, idx) => `Kapitel ${idx + 1}: ${shorten(txt, 320)}`)
      .slice(-3)
      .join("\n\n");

    const lastScenePreview = extractLastScenePreview(previousChapters);
    const usedLastScenePreview = !!lastScenePreview;

    const effectivePrompt =
      promptRaw && String(promptRaw).trim()
        ? String(promptRaw).trim()
        : (worldState._userPrompt ||
           worldState.last_prompt ||
           "");

    const mainGoal =
      worldState.meta?.mainGoal ||
      worldState.meta?.originalPrompt ||
      "";

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
    // SYSTEMPROMPT – BN-Kids Hard Mode
    // ------------------------------------------------------
    const systemPrompt = buildSystemPrompt_BNKids_HardMode(ageKey);

    // ------------------------------------------------------
    // USERPROMPT – barnets idé + worldstate + kapitelroll + Hard Mode
    // ------------------------------------------------------
    const lines = [];

    // Barnets idé + meta
    lines.push(`Barnets idé / prompt just nu: "${effectivePrompt}"`);
    lines.push("");
    lines.push(`Hjälte: ${heroName}`);
    lines.push(`Åldersband: ${ageKey} år`);
    lines.push(`Längdpreset: ${lengthPreset}`);
    lines.push(`Storyläge: ${storyMode}`);
    if (storyMode === "chapter_book") {
      lines.push(
        `Detta är kapitel ${chapterIndex} i en kapitelbok (totalt ungefär ${totalChapters} kapitel).`
      );
    } else {
      lines.push("Detta är en fristående saga (single_story).");
    }
    lines.push("");

    // Huvudmål / huvudtråd (Hard Mode)
    if (storyMode === "chapter_book") {
      lines.push(
        "Huvudmålet i den här boken ska vara tydligt och konsekvent genom alla kapitel."
      );
      if (mainGoal) {
        lines.push(
          `Övergripande huvudmål som ska följas i varje kapitel (ändra inte detta utan mycket stark orsak):`
        );
        lines.push(`"${shorten(mainGoal, 260)}"`);
      } else {
        lines.push(
          "Utifrån barnets idé ska du själv tolka ett tydligt huvudmål (t.ex. lära sig något, lösa ett problem, ta reda på något). Detta huvudmål ska sedan gälla i alla kapitel."
        );
      }
      lines.push(
        "Du får INTE byta huvudmål mitt i boken. Varje kapitel ska föra hjälten närmare samma mål, eller visa ett hinder på vägen mot det målet."
      );
      lines.push("");
    }

    // Sammanfattning + historik
    if (storyMode === "chapter_book") {
      if (previousSummary) {
        lines.push("Kort sammanfattning av vad som hänt hittills i boken:");
        lines.push(shorten(previousSummary, 420));
        lines.push("");
      } else if (previousChaptersCount) {
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

      if (lastScenePreview) {
        lines.push("Den senaste scenen i föregående kapitel slutade ungefär så här:");
        lines.push(`"${lastScenePreview}"`);
        lines.push(
          "Detta nya kapitel ska börja som en direkt fortsättning på den scenen, på ett naturligt sätt."
        );
        lines.push(
          "Du får INTE starta om berättelsen, hoppa tillbaka till en helt ny morgon eller beskriva en helt ny 'första dag'. Tiden ska gå framåt från den här scenen."
        );
        lines.push("");
      }
    }

    // Kapitelroll-instruktioner (Hard Mode)
    lines.push(`Kapitelroll just nu: ${chapterRole}.`);

    if (chapterRole === "chapter_1" && storyMode === "chapter_book") {
      lines.push(
        "Kapitel 1 ska börja i vardagen (plats, tid, enkel aktivitet) innan magi/äventyr eller huvudproblemet dyker upp."
      );
      lines.push(
        "Barnets idé ska vävas in gradvis – inte allt på första meningen."
      );
      lines.push(
        "Du får gärna beskriva väder eller omgivning, men undvik slitna fraser som 'Det var en solig dag' eller 'Fåglarna kvittrade'. Hitta egna, mer konkreta sätt att visa stämningen."
      );
      lines.push(
        "I kapitel 1 ska du också så tydligt som möjligt plantera huvudmålet (utan att skriva 'huvudmål'). Visa i handling vad hjälten vill uppnå."
      );
    } else if (chapterRole === "chapter_middle" && storyMode === "chapter_book") {
      lines.push(
        "Detta är ett mittenkapitel. Fortsätt samma huvudmål och samma handlingstråd som tidigare."
      );
      lines.push(
        "Kapitel 2 och framåt får INTE kännas som en ny saga. Använd inte omstartfraser som 'Det var en solig dag…' eller 'Det var en vanlig lördag…' och börja inte om från morgonen igen."
      );
      lines.push(
        "Visa ett tydligt delmål eller hinder på vägen, men introducera inte en helt ny huvudkonflikt."
      );
      lines.push(
        "Du får introducera högst en ny viktig karaktär i detta kapitel, och bara om den har en tydlig roll kopplad till huvudmålet."
      );
      lines.push(
        "Om boken innehåller magi eller ett speciellt föremål ska du hålla dig till samma magisystem och samma föremål. Hitta inte på nya, orelaterade magiska grejer i varje kapitel."
      );
    } else if (chapterRole === "chapter_final" && storyMode === "chapter_book") {
      lines.push(
        "Detta ska vara ett avslutande kapitel i samma bok, med samma karaktärer och samma huvudmål."
      );
      lines.push(
        "Du får INTE starta en ny berättelse eller hoppa till en helt ny plats som inte förberetts tidigare."
      );
      lines.push(
        "Knyt ihop de viktigaste trådarna och lös huvudkonflikten tydligt och barnvänligt."
      );
      lines.push(
        "Avsluta varmt och hoppfullt, men utan att skriva ut moralen rakt ut eller använda slitna fraser som 'det viktigaste är att tro på sig själv'."
      );
    } else if (chapterRole === "single_story") {
      lines.push(
        "Detta ska vara en komplett saga i ett enda stycke, anpassad till barnets åldersgrupp."
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
          "Du ska fortsätta samma bok och samma huvudmål, men väva in den nya önskan naturligt i det som händer nu."
        );
        lines.push(
          "Det får inte kännas som en ny separat saga, utan som nästa scen i samma berättelse."
        );
      } else {
        lines.push(
          "Viktigt: Barnet har INTE ändrat prompten sedan förra kapitlet."
        );
        lines.push(
          "Fortsätt exakt där förra kapitlet slutade. Starta inte om, hoppa inte tillbaka i tiden och hitta inte på en ny huvudberättelse."
        );
      }
      lines.push("");
    }

    // Längdinstruktion + utdataregel
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
      temperature: 0.7, // lite lägre för stabilare kapiteltråd
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

    const debug = {
      ok: true,
      engineVersion: ENGINE_VERSION,
      chapterIndex,
      storyMode,
      ageKey,
      lengthPreset,
      totalChapters,
      previousChaptersCount,
      promptChanged,
      usedLastScenePreview
    };

    // HUVUDSVAR – ws_button.gc.js använder .story
    return json({ ok: true, story, debug }, 200, origin);
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
            "Skriv på ett enkelt, tydligt och tryggt sätt som passar 7–8 år. Korta meningar, tydliga känslor, få karaktärer, inga subplots. Max en enkel gåta i hela boken.",
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

function buildSystemPrompt_BNKids_HardMode(ageKey) {
  return `
Du är BN-Kids berättelsemotor i HARD MODE. Din uppgift är att skriva barnanpassade sagor och kapitelböcker på svenska, med mycket stark respekt för kontinuitet, huvudmål och åldersnivå.

### FOKUS & GENRE
- Följ alltid barnets prompt och tema noggrant.
- Byt aldrig genre eller huvudtema på egen hand.
- Om barnet nämner ett yrke (t.ex. detektiv, fotbollsspelare, trollkarl) ska kapitlen kretsa kring det yrket.
- Om barnet nämner ett viktigt objekt (t.ex. en magisk bok, en gitarr, en vattenkanna) ska objektet vara centralt tills huvudkonflikten är löst.
- Undvik mörker/skräck, hotfulla skuggor och monster om barnet inte specifikt ber om det.

### ÅLDERSBAND (${ageKey})
Anpassa språk, tempo och komplexitet efter åldern:
- 7–8: enklare meningar, tydliga känslor, få karaktärer, inga subplots. Max EN enkel gåta i hela boken, inte en gåta i varje kapitel.
- 9–10: lite mer detaljer, lite mer spänning, max en enkel sidotråd.
- 11–12: mer djup, mer dialog, mer avancerade känslor, fortfarande tryggt.
- 13–15: något mognare, men fortfarande barnvänligt och utan grafiskt våld eller sex.

### HARD MODE – FLOW & STARTER
- Börja aldrig varje kapitel med samma typ av mening som "Det var en solig dag", "Det var en vanlig lördag" eller "Fåglarna kvittrade i träden". Använd den typen av start högst en gång per bok.
- Kapitel ska börja i vardagen: plats, tid, enkel aktivitet, men på varierade sätt (olika formuleringar och detaljer).
- I mittenkapitel (kapitel 2 och framåt) ska du i stället ofta börja mitt i en handling eller känsla som fortsätter från förra kapitlet.
- Ge 3–6 meningar startscen innan du eskalerar problemet eller magin, men undvik utdraget väderprat och klyschor.
- Variera miljöer och objekt: använd inte alltid samma träd, samma kojor, samma skattkartor, samma böcker eller samma "mystiska röst bakom ryggen".
- "En röst bakom sig" eller liknande billiga skräcktriggers är förbjudna.

### HARD MODE – HUVUDMÅL & MAGI
- Identifiera ett tydligt huvudmål för hjälten (t.ex. "lära sig spela gitarr", "förstå vad den magiska kannan kan göra", "hitta sin försvunna vän").
- Detta huvudmål ska vara stabilt genom hela boken. Byt inte huvudmål mitt i berättelsen.
- Varje kapitel ska antingen:
  - föra hjälten närmare huvudmålet, eller
  - visa ett hinder eller bakslag på vägen mot huvudmålet.
- Om boken innehåller magi eller ett speciellt föremål får du inte hitta på ett nytt, helt orelaterat magiskt system i varje kapitel. Håll dig till samma typ av magi.
- För åldern 7–8: max ett huvudsakligt magiskt element per bok (t.ex. en magisk gitarr, en magisk vattenkanna, en magisk dörr). Nya magiska saker ska nästan alltid kopplas till det elementet.

### KARAKTÄRER (HARD MODE)
- Håll antalet viktiga karaktärer lågt, särskilt för 7–8 år.
- Introducera max 1–2 nya karaktärer i kapitel 1.
- I senare kapitel (2, 3, 4 …) får du introducera högst 1 ny viktig karaktär per kapitel, och bara om den har en tydlig roll kopplad till huvudmålet.
- Karaktärer får inte byta namn, kön eller personlighet utan tydlig förklaring.
- Hjälten ska vara i centrum i alla kapitel. Nya karaktärer ska stödja eller utmana hjälten, inte ta över berättelsen.

### KAPITELBOKSLÄGE (KONTINUITET)
När du skriver en kapitelbok:
- Kapitel 1: introducera vardagen, huvudpersonen, miljön och det första fröet till huvudproblemet. Lugn start, öka spänningen mot slutet av kapitlet.
- Mittenkapitel (2, 3, 4 …): fortsätt utforska samma huvudmål. Visa hinder, framsteg och små överraskningar. Max en enkel sidotråd. Upprepa inte samma scen (t.ex. bygga samma koja eller hitta samma bok) utan tydlig orsak.
- Slutkapitel: knyt ihop de viktigaste trådarna, lös huvudkonflikten tydligt och barnvänligt. Introducera inte stora nya karaktärer eller nya huvudproblem.
- Ge gärna en mjuk cliffhanger i mittenkapitel, men inte i varje kapitel och aldrig i sista kapitlet.
- I kapitel 2 och framåt ska du undvika att skriva som om det vore ett helt nytt startkapitel. Det ska kännas som nästa del i samma bok, inte som en ny saga på samma tema.

### KONTINUITET – SCEN & TID
- Tiden ska kännas som att den går framåt. Undvik att hoppa tillbaka till samma tidpunkt utan mycket tydlig förklaring.
- Fortsätt ofta i samma scen eller direkt efter scenen från föregående kapitel, särskilt om slutet var en cliffhanger eller ett viktigt ögonblick.
- Byt miljö eller plats bara om det på något sätt motiveras av vad som hänt tidigare (t.ex. "Nästa dag gav de sig av mot skolan," eller "Senare på kvällen möttes de igen i parken").

### MORAL & TON
- Visa känslor och värden genom handling, val och dialog — inte genom predikande meningar.
- Undvik fraser som (eller varianter av):
  - "det viktiga är att tro på sig själv"
  - "du måste vara modig"
  - "det viktigaste är vänskap"
  - "detta äventyr skulle de aldrig glömma"
  - "äventyret hade bara börjat"
  - "de stod på tröskeln till sitt livs äventyr"
- Avslut får gärna vara varma och hoppfulla, men utan att skriva ut moralen rakt ut.
- Ingen romantik för 7–8. För 9–10 och 11–12 kan oskyldiga crush-känslor förekomma om barnet antyder det, men håll dem subtila och barnvänliga.

### SPRÅKSTIL
- Använd barnvänligt, vardagligt språk.
- För 7–8: kortare meningar, tydliga känslor, inga långa utläggningar med flera bisatser.
- Variera meningslängd. Blanda korta och lite längre meningar.
- Använd ordet "modig" högst en gång per kapitel.

### UTDATA
- Skriv endast berättelsetexten.
- Inga rubriker som "Kapitel 1" om inte användaren tydligt vill det.
- Inga punktlistor, inga "Lärdomar:", inga förklaringar om varför du skrev som du gjorde.
`.trim();
}

function extractLastScenePreview(previousChapters) {
  if (!previousChapters || !previousChapters.length) return "";
  const last = String(
    previousChapters[previousChapters.length - 1] || ""
  ).trim();
  if (!last) return "";

  const sentences = last
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!sentences.length) return "";

  const count = Math.min(3, sentences.length);
  return sentences.slice(-count).join(" ");
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
