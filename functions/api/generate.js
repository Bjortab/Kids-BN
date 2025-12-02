// functions/api/generate.js
// BN-KIDS — Cloudflare Pages Function: POST /api/generate
//
// GC v8.2 – Magic Engine (mild konsekvens, A2 prompt-fidelitet)
// - Behåller fungerande kapitelmotor (chapterIndex via previousChapters.length)
// - 7–8: lite mjukare, får förenkla prompten försiktigt
// - 9–10: mittemellan
// - 11–12 & 13–15: hård prompt-fidelitet (följ barnets idé mycket exakt)
// - Mild konsekvensmotor: undvik uppenbart ologiska detaljer (t.ex. kikare i ubåt)
// - Floskelkontroll: hårt förbud mot dina hatfraser, övriga bara via stilregler
// - Fokus på naturlig, modern svenska (inte översatt känsla)

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

    // Enkel "progress" per bok – hint, inte hård logik.
    const progress = worldState.progress || {};

    // Barnet kan uttryckligen vilja avsluta hela sagan / följetongen här.
    const wantsSeriesEnd =
      /avslut(a)? hela sagan|nu avslutar vi sagan|sista boken|slutet på allt|nu tar allt slut/i
        .test(promptRaw || "");

    // ------------------------------------------------------
    // Robust kapitelIndex: räkna från historiken (kapitelmotorn)
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
    } else if (userWantsEnd || wantsSeriesEnd || chapterIndex >= totalChapters) {
      chapterRole = "chapter_final";
    } else {
      chapterRole = "chapter_middle";
    }

    // Följetongs-fas hint (per bok)
    const seriesPhase = getSeriesPhaseForBook(chapterIndex, totalChapters);

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
    // SYSTEMPROMPT – BN-Kids stil + regler (GC v8.2)
    // ------------------------------------------------------
    const systemPrompt = buildSystemPrompt_BNKids_v8_2(ageKey);

    // ------------------------------------------------------
    // USERPROMPT – barnets idé + worldstate + kapitelroll + följetong + promptChanged
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
      lines.push(
        `Denna bok är del av en längre följetong. I JUST DENNA BOK ligger fokus på: ${seriesPhase}.`
      );
      if (!wantsSeriesEnd && !userWantsEnd) {
        lines.push(
          "Du ska inte rädda världen eller avsluta alla stora problem i denna bok. Lös bara det lilla deläventyret här, och lämna plats för större saker i senare böcker."
        );
      } else {
        lines.push(
          "Barnet ber om ett riktigt avslut på sagan. Här får du knyta ihop den större berättelsen också på ett tydligt men barnvänligt sätt."
        );
      }
    } else {
      lines.push("Detta är en fristående saga (single_story).");
    }
    lines.push("");

    // Progress-hint (enkel, per bok)
    if (storyMode === "chapter_book") {
      const simpleProgress = [];

      if (progress.magicTrainingLevel != null) {
        simpleProgress.push(
          `magiträningsnivå ≈ ${progress.magicTrainingLevel}`
        );
      }
      if (Array.isArray(progress.knownSpells) && progress.knownSpells.length) {
        simpleProgress.push(
          `kända trollformler: ${progress.knownSpells.join(", ")}`
        );
      }
      if (Array.isArray(progress.importantObjects) && progress.importantObjects.length) {
        simpleProgress.push(
          `viktiga föremål: ${progress.importantObjects.join(", ")}`
        );
      }

      if (simpleProgress.length) {
        lines.push("Enkel progress-status för denna bok:");
        lines.push(simpleProgress.join(" | "));
        lines.push(
          "Du får bara använda magi, teknik och föremål som är rimliga utifrån denna status, om inte barnet uttryckligen ber om något nytt i sin prompt."
        );
        lines.push("");
      }
    }

    // Sammanfattning + historik (utan att uppmuntra recap i texten)
    if (storyMode === "chapter_book") {
      if (previousSummary) {
        lines.push(
          "Kort intern sammanfattning av vad som hänt hittills i boken (denna är för dig, inte något som ska återges i kapitlet):"
        );
        lines.push(shorten(previousSummary, 420));
        lines.push(
          "Du ska INTE skriva en lång recap i början av kapitlet. Använd bara detta för att komma ihåg vad som hänt."
        );
        lines.push("");
      } else if (previousChaptersCount > 0) {
        lines.push(
          "Tidigare kapitel finns, men ingen separat sammanfattning är sparad. Här är några saker som hänt (bara som minne för dig, inte som text att upprepa):"
        );
        lines.push(compactHistory || "- inga sparade kapitel ännu");
        lines.push(
          "Du ska INTE börja kapitlet med att återberätta allt detta. Gå direkt in i nuvarande situation."
        );
        lines.push("");
      } else {
        lines.push(
          "Detta verkar vara början på boken. Inga tidigare kapitel är sparade."
        );
        lines.push("");
      }
    }

    if (
      storyMode === "chapter_book" &&
      previousChaptersCount > 0 &&
      lastScenePreview
    ) {
      lines.push(
        "Här är slutet av förra kapitlet (den scen du ska fortsätta direkt efter). Detta är en intern påminnelse – du ska inte citera den, bara fortsätta där den slutar:"
      );
      lines.push(lastScenePreview);
      lines.push("");
    }

    // Kapitelroll-instruktioner
    lines.push(`Kapitelroll just nu: ${chapterRole}.`);

    if (chapterRole === "chapter_1" && storyMode === "chapter_book") {
      lines.push(
        "Kapitel 1 ska börja i vardagen eller i en lugn startscen: visa plats, tid och en enkel aktivitet innan magi/äventyr eller huvudproblemet dyker upp."
      );
      lines.push(
        "Barnets idé ska vävas in gradvis – inte allt på första meningen."
      );
    } else if (chapterRole === "chapter_middle" && storyMode === "chapter_book") {
      lines.push(
        "Detta är ett mittenkapitel. Fortsätt samma huvudmål som tidigare, i följetongs-tempo."
      );
      lines.push(
        "Börja precis där förra kapitlet slutade. Upprepa inte samma startscen eller dialog. Gå rakt in i nuet."
      );
      lines.push(
        "Skapa ett tydligt delmål eller hinder på vägen, men introducera inte en helt ny huvudkonflikt."
      );
    } else if (chapterRole === "chapter_final" && storyMode === "chapter_book") {
      if (wantsSeriesEnd || userWantsEnd) {
        lines.push(
          "Detta ska vara ett avslutande kapitel för hela sagan (inte bara denna bok). Knyt ihop de större trådarna och ge ett tydligt slut som ändå känns tryggt."
        );
      } else {
        lines.push(
          "Detta ska vara ett avslutande kapitel i just denna bok, med samma karaktärer och samma huvudmål."
        );
        lines.push(
          "Du får INTE starta en ny berättelse eller hoppa till en helt ny plats som inte förberetts."
        );
        lines.push(
          "Lös det lilla delproblemet i denna bok på ett tydligt och barnvänligt sätt, men lämna utrymme för större saker i framtida böcker."
        );
      }
      lines.push(
        "Avsluta i en konkret scen, utan att skriva ut moralen eller använda klyschor om att äventyret bara börjat."
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
      }
      lines.push("");
    }

    // Längdinstruktion
    lines.push(lengthInstruction);
    lines.push("");
    lines.push(
      "VIKTIGT: Svara enbart med själva berättelsen i löpande text. Inga rubriker, inga punktlistor, inga 'Lärdomar:' och inga förklaringar om varför du skrev som du gjorde."
    );
    lines.push(
      "Skriv all text direkt på svenska med naturlig, modern barnboksprosa. Undvik formuleringar som låter som direktöversatt engelska."
    );

    const userPrompt = lines.join("\n");

    // ------------------------------------------------------
    // OpenAI-anrop
    // ------------------------------------------------------
    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    const payload = {
      model,
      temperature: 0.7, // kontroll via prompt + milda regler
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
    const rawStory =
      data.choices?.[0]?.message?.content?.trim() || "";

    const story = sanitizeStory(rawStory);

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
          lastScenePreview,
          seriesPhase,
          wantsSeriesEnd
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
            "Skriv med mer djup och tempo som passar 11–12 år. Mer känslor, mer detaljerade scener, ibland mer episka äventyr.",
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

// Enkel följetongs-fas per bok
function getSeriesPhaseForBook(chapterIndex, totalChapters) {
  const total = totalChapters && totalChapters > 0 ? totalChapters : 10;
  const ratio = chapterIndex / total;

  if (ratio <= 0.3) {
    return "att lära känna vardagen, platsen och de viktigaste personerna och ta de allra första små stegen i äventyret";
  } else if (ratio <= 0.6) {
    return "att träna magi eller teknik i små steg och lösa små, lokala problem";
  } else if (ratio <= 0.9) {
    return "att stöta på ett lite större men fortfarande hanterbart problem";
  } else {
    return "att lösa ett mindre problem i denna bok och ge en mjuk hook mot framtida äventyr";
  }
}

// Systemprompt GC v8.2 – Magic Engine, mild konsekvens, A2 prompt-fidelitet
function buildSystemPrompt_BNKids_v8_2(ageKey) {
  return `
Du är BN-Kids berättelsemotor. Din uppgift är att skriva barnanpassade, spännande och sammanhängande sagor och kapitelböcker på svenska.

## 1. FOKUS & GENRE
- Följ alltid barnets prompt och tema noggrant.
- Byt aldrig huvudgenre på egen hand (deckare → håll dig till mysterium, rymd → håll dig till rymdäventyr, tidsmaskin → håll dig till tidsresor).
- Om barnet nämner viktiga objekt (magisk bok, tidsmaskin, rymdskepp, robot, kristall, marknad, drake) ska de vara centrala tills konflikten kring dem är löst.
- Du får inte tona ner stora idéer (t.ex. framtid, tidsresor, cyborger) till små vardagsproblem som att bära ved, om inte barnet själv ber om det.

## 2. ÅLDERSBAND (${ageKey}) & TON
Anpassa språk, tempo och komplexitet:

- 7–8:
  - Enklare meningar, tydliga känslor, få karaktärer, inga subplots.
  - Du får förenkla barnets idé lite om den är väldigt komplex eller läskig, men kärnan ska kännas igen direkt.
- 9–10:
  - Mer detaljer, mer dialog, lite mer spänning.
  - Du ska följa barnets idé, men du får lägga till små egna detaljer som passar genren.
- 11–12:
  - Mer djup, tempo och äventyr. Mer känslor, mer detaljerade scener, fortfarande tryggt.
  - Hård prompt-fidelitet: följ barnets idé mycket exakt. Byt inte mål, miljö eller typ av äventyr.
- 13–15:
  - Något mognare, mer komplex handling, men fortfarande barnvänligt.
  - Hård prompt-fidelitet: följ barnet noggrant och behåll seriös ton.

Skriv alltid på naturlig, modern svenska – som en bra barn- eller ungdomsbok, inte som en översatt text.

## 3. FLOW & STARTSCENER
- Börja aldrig första meningen med att bara upprepa barnets prompt rakt av.
- Kapitel 1: vardag eller lugn startscen (plats, tid, aktivitet, stämning) innan magi/äventyr exploderar.
- Senare kapitel: gå direkt in i den pågående situationen efter förra kapitlets slut.
- Undvik slentrianfraser som:
  - "Det var en solig dag" / "Solen lyste in genom fönstret"
  - "Bakom dem såg de plötsligt..."
  - "Vid den stora gamla eken..."
- Använd dialog naturligt men inte i varje mening. Blanda korta och längre meningar.

## 4. MAGI, TEKNIK & KONSEKVENS (MILD)
- Magi och teknik ska utvecklas stegvis: först små försök, sedan bättre kontroll.
- Ett föremål som redan öppnats utan nyckel ska inte plötsligt kräva en nyckel senare, om inte barnet ber om det.
- Håll miljön konsekvent på en grundnivå:
  - I en ubåt: metall, trånga utrymmen, vatten runtom, instrument, lampor. Skriv inte om himmel, träd eller att stå ute i regnet, om de inte tar sig upp.
  - I rymden: vakuum, rymdskepp, planeter, stationer. Skriv inte om att känna vinden i håret om de är inuti skeppet.
  - Vid tidsresor: håll fast vid epoken tills det finns en tydlig scen där de reser vidare.
- Om du låter barnen uppfinna något (t.ex. en tidsmaskin eller speciell ubåt), använd den uppfinningen konsekvent i kapitlen.

## 5. GÅTOR & UPPGIFTER
- Skriv inte in gåtor om inte barnet tydligt ber om det.
- Om en gåta används:
  - ska den vara enkel och lösas tydligt i samma sekvens,
  - ska den inte följas av fler gåtor i samma bok.

## 6. MORAL, FLOSKLER OCH KÄNSLOR
- Visa värden (vänskap, mod, lojalitet) genom handling och dialog, inte genom predikande meningar.
- Dessa fraser och varianter får du ALDRIG använda:
  - "äventyret hade bara börjat"
  - "en gnista av mod"
  - "kände hur något växte i honom" (eller henne dem)
  - "en varm känsla i bröstet"
  - "visste att något stort väntade honom" (eller henne dem)
- Uttryck som:
  - "hjärtat dunkade hårt"
  - "det var bara början"
  - "plötsligt kände han/hon..."
  får bara användas mycket sparsamt och bara när scenen motiverar det. De får aldrig användas som klyschigt kapitelavslut.
- Undvik moralkakor som:
  - "det viktiga är att tro på sig själv"
  - "det viktigaste är vänskap"
  - "det här var ett äventyr de aldrig skulle glömma"
- Avslut ska helst vara i scen (vad de ser/gör/säger), inte en sammanfattande moral.

## 7. KAPITELBOK & FÖLJETONG
- Kapitel 1: introducera vardagen, huvudpersonen, miljön och första fröet till problemet.
- Mittenkapitel: samma huvudmål, nya hinder och framsteg. Inga onödiga omstarter.
- Slutkapitel: knyt ihop huvudtråden i just denna bok, utan att kasta in stora nya problem i sista stund. En liten hook mot framtiden går bra.

## 8. KONTINUITET & INGA OMSTARTER
- Fortsätt där förra kapitlet slutade. Du får inte skriva ett nytt "första kapitel" mitt i boken.
- Karaktärer får inte byta namn, kön eller personlighet utan förklaring.
- Viktiga föremål (magisk bok, tidsmaskin, rymdskepp, robot, drake, marknad) ska användas konsekvent.
- Om en scen avbröts (t.ex. de håller på att rita en karta, bygga något, smyga in någonstans) ska du fortsätta där de slutade i nästa kapitel, inte börja om.

## 9. PROMPT-FIDELITET (A2-läge)
- 7–8: Du får förenkla lite, men barnets idé ska kännas igen direkt.
- 9–10: Följ barnets idé tydligt, men du får lägga till små egna detaljer som passar genren.
- 11–12 och 13–15: Hård prompt-fidelitet.
  - Ändra inte genre, huvudmål eller miljö.
  - Om barnet säger framtid, tidsmaskin, cyborger eller rymd ska det stå i centrum.
  - Undvik att tona ner till små vardagssysslor som inte hör till huvudidén.

## 10. UTDATA
- Skriv endast berättelsetexten.
- Inga rubriker som "Kapitel 1" om inte barnet tydligt ber om det.
- Inga punktlistor.
- Inga "Lärdomar:" eller förklaringar om varför du skrev som du gjorde.
`.trim();
}

function shorten(text, maxLen) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

// Post-filter för att ta bort just dina hatfraser om de ändå skulle smita igenom
function sanitizeStory(raw) {
  if (!raw) return "";

  let s = String(raw);

  const banned = [
    /äventyret hade bara börjat/gi,
    /en gnista av mod/gi,
    /kände hur något växte i honom/gi,
    /kände hur något växte i henne/gi,
    /kände hur något växte i dem/gi,
    /en varm känsla i bröstet/gi,
    /visste att något stort väntade honom/gi,
    /visste att något stort väntade henne/gi,
    /visste att något stort väntade dem/gi
  ];

  for (const pattern of banned) {
    s = s.replace(pattern, "");
  }

  return s.trim();
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
