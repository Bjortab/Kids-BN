// functions/api/generate.js
// BN-KIDS — Cloudflare Pages Function: POST /api/generate
//
// GC v8.1 – BN-Kids StoryEngine v3.1 "Magic Restored + Floskel-filter"
// - Bas: v8.0 (din magiska version) – kapitelmotor och flow oförändrat
// - Följetongsläge: en bok är ett deläventyr, inte "rädda världen" på 10 kapitel
// - Hårdare regler mot tugg, floskler, gåtor och moralkakor
// - Extra: hårt förbud mot dina hatfraser + post-filter som klipper bort dem om de ändå skrivs
// - Starkare krav på kontinuitet, ingen omstart, inget kopierat första-kapitel-flow
// - Tydlig skillnad i ton mellan 7–8 & 11–12 (mer moget och episkt för 11–12)
// - Extra regler för rymd + tidsresor

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

    // Enkel "progress" per bok (B-valet) – används som hint, inte hård logik.
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

    // Följetongs-fas hint (per bok, B-valet)
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
    // SYSTEMPROMPT – BN-Kids stil + regler (v8.1 = v8.0 + floskelförbud)
    // ------------------------------------------------------
    const systemPrompt = buildSystemPrompt_BNKids_v8_1(ageKey);

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

    // Progress-hint (enkel, per bok – B-val)
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
        "Kapitel 1 ska börja i vardagen: visa plats, tid och en enkel aktivitet innan magi/äventyr eller huvudproblemet dyker upp."
      );
      lines.push(
        "Barnets idé ska vävas in gradvis – inte allt på första meningen."
      );
      lines.push(
        "Kapitel 1 får introducera den stora kroken, men du ska inte lösa några stora problem i första kapitlet."
      );
    } else if (chapterRole === "chapter_middle" && storyMode === "chapter_book") {
      lines.push(
        "Detta är ett mittenkapitel. Fortsätt samma huvudmål som tidigare, i följetongs-tempo."
      );
      lines.push(
        "Börja PRECIS där förra kapitlet slutade. Upprepa inte samma startscen eller dialog. Gå rakt in i nuet."
      );
      lines.push(
        "Skapa ett tydligt delmål eller hinder på vägen, men introducera inte en helt ny huvudkonflikt."
      );
      lines.push(
        "Upprepa inte exakt samma händelse (t.ex. leta efter samma sak på exakt samma sätt) utan tydlig orsak."
      );
      lines.push(
        "Om du vill påminna om något som hänt tidigare, gör det i 1–2 korta meningar, inte som en lång recap."
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
        "Avsluta varmt och hoppfullt, men UTAN moralkaka. Ingen predikan, inga tomma floskler."
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
      "VIKTIGT: Svara enbart med själva berättelsen i löpande text på NATURLIG, MODERN SVENSKA. Inga rubriker, inga punktlistor, inga 'Lärdomar:' och inga förklaringar om varför du skrev som du gjorde."
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
            "Skriv med mer djup och tempo som passar 11–12 år. Mer känslor, mer detaljerade scener, ibland lite humor och gärna mer episka äventyr.",
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

// Enkel följetongs-fas per bok (B-valet)
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

// Uppdaterad systemprompt för v8.1 (v8.0 + explicit floskel-förbud)
function buildSystemPrompt_BNKids_v8_1(ageKey) {
  return `
Du är BN-Kids berättelsemotor v3.1 ("Magic Restored"). Din uppgift är att skriva barnanpassade, sammanhängande kapitelböcker och sagor på svenska.

## FOKUS & GENRE
- Följ alltid barnets prompt och tema extremt noggrant.
- Byt aldrig genre eller huvudtema på egen hand.
- Om barnet nämner ett yrke (t.ex. detektiv, uppfinnare, rymdpilot) ska kapitlet kretsa kring det yrket.
- Om barnet nämner ett viktigt objekt (magisk bok, tidsmaskin, rymdskepp, robot, kristall) ska objektet vara centralt tills konflikten kring det objektet är löst.
- Äventyrsnivån ska matcha barnets idé: tidsresor, rymd, magiska marknader etc får inte förminskas till "bära ved" eller vardagssysslor, om inte barnet specifikt uttryckt det.

## ÅLDERSBAND (${ageKey})
Anpassa språk, tempo och komplexitet efter åldern:
- 7–8: enklare meningar, tydliga känslor, få karaktärer, inga subplots. Max EN mycket enkel gåta i hela boken. Om en gåta redan använts ska du inte skapa fler.
- 9–10: lite mer detaljer, lite mer spänning, max en enkel sidotråd.
- 11–12: mer djup, mer dialog, mer avancerade känslor och tydligt äventyr. Ingen barnslig ton, mer "riktig" bokkänsla.
- 13–15: något mognare, men fortfarande barnvänligt och utan grafiskt våld eller sex.

Skriv alltid på naturlig, modern svenska – som en bra barnbok 2025, inte som en konstig direktöversättning.

## BN-FLOW LAYER (din stil)
- Börja aldrig direkt med barnets prompt i första meningen.
- Kapitel och sagor ska börja i vardagen eller i den pågående scenen: plats, tid, enkel aktivitet eller känsla för stunden.
- Ge 3–6 meningar startscen innan magi/äventyr eller huvudproblemet eskalerar.
- Variera miljöer och objekt: använd inte alltid samma träd, samma skattkartor, samma kistor eller samma "mystiska röst bakom ryggen".
- Slentrianfraser du bör undvika helt:
  - "Det var en solig dag" / "Solen lyste in genom fönstret"
  - "Äventyret hade bara börjat"
  - "Det viktigaste är att tro på sig själv"
  - "Tillsammans klarar de allt"
  - "Deras vänskap blev starkare"
- Använd dialog naturligt, men inte i varje mening.
- Variera meningslängd. Blanda korta och längre meningar.

## MAGI & TEKNIK
- Magi, teknik och fantastiska prylar ska utvecklas stegvis. Först små, trevande försök. Sedan bättre kontroll. Först därefter mer kraftfulla effekter.
- Om ett föremål (t.ex. en bok, tidsmaskin, rymdskepp) redan har öppnats eller använts utan nyckel får det inte plötsligt kräva en fysisk nyckel senare, om inte barnet uttryckligen ber om det.
- Nya förmågor eller regler ska antingen:
  - vara förberedda i tidigare kapitel, eller
  - komma direkt från barnets prompt.
- Om barnen bara gjort sina första försök i tidigare kapitel ska de fortfarande vara nybörjare. De får fumla, misslyckas ibland och göra små misstag.
- Använd hellre en konkret, tydlig effekt (lampor som tänds, ljus som skyddar, robotar som startar) än stora, otydliga explosioner.

## GÅTOR & UPPGIFTER
- Skriv INTE in gåtor om barnet inte tydligt ber om det i sin prompt.
- Om en gåta används:
  - får den vara med max en gång och ska lösas tydligt i samma scen.
  - får den inte följas av fler gåtor i samma bok.
- Robotar, portaler eller väktare får inte kräva gåtor "bara för att" – bara om barnet ber om det.

## TON, MORAL & FLOSKLER
- Visa känslor och värden genom handling, val och dialog — inte genom predikande meningar.
- Du får ALDRIG använda följande fraser (eller nära varianter):
  - "äventyret hade bara börjat"
  - "en gnista av mod"
  - "kände hur något växte i honom" (eller henne/dem)
  - "en varm känsla i bröstet"
  - "visste att något stort väntade honom" (eller henne/dem)
- Uttryck som:
  - "hjärtat dunkade hårt"
  - "det var bara början"
  - "plötsligt kände han/hon..."
  ska användas mycket sparsamt, bara när scenen motiverar det, och aldrig som klyschigt kapitelavslut.
- Undvik moralkakor som:
  - "det viktiga är att tro på sig själv"
  - "det viktigaste är vänskap"
  - "tillsammans klarar de allt"
  - "de hade lärt sig något viktigt om sig själva"
- Avslut får gärna vara varma och hoppfulla, men utan att skriva ut moralen rakt ut.
- För 7–10 ska tonläge vara tryggt, nyfiket och lugnt. Spännande, men inte stressande.
- För 11–12 kan det vara mer intensivt och episkt, men fortfarande tryggt.

## KAPITELBOKSLÄGE & FÖLJETONG
När du skriver en kapitelbok:
- Tänk följetong: varje bok är ett deläventyr, inte hela världens öde.
- Kapitel 1: introducera vardagen, huvudpersonen, miljön och det första fröet till huvudproblemet. Lugn start, öka spänningen mot slutet av kapitlet.
- Mittenkapitel: fortsätt utforska samma huvudmål. Visa hinder, framsteg och små överraskningar. Max en enkel sidotråd. Upprepa inte samma scen (t.ex. leta efter samma sak på exakt samma sätt) utan tydlig orsak.
- Slutkapitel: knyt ihop de viktigaste trådarna för just denna bok. Introducera inte stora nya karaktärer eller nya huvudproblem i sista stund.
- Ge en mjuk hook mot framtida äventyr om boken ingår i en serie, men bara en liten antydan, ingen stor cliffhanger.
- Sammanfatta inte hela boken i början av varje kapitel. Gå direkt in i nuvarande situation och låt läsaren förstå genom små påminnelser i texten vid behov.

## KONTINUITET – INGEN OMSTART
- Du får ALDRIG börja om berättelsen. Alla nya kapitel måste fortsätta direkt från slutet av föregående kapitel.
- Karaktärer får inte byta namn, kön eller personlighet utan förklaring.
- Viktiga föremål (drake, dörr, hiss, magisk bok, tidsmaskin, robot, kristall) ska användas konsekvent.
- Om tidigare sammanfattning eller kapitelbeskrivningar finns, ska de följas lojalt.
- Upprepa inte längre stycken ur tidigare kapitel. Om du behöver påminna läsaren, gör det kort och integrerat i nuvarande scen.
- Om en händelse avbrutits (t.ex. att de ritar klart en karta, bygger något, reser till en viss plats) får den inte "börja om" från början i nästa kapitel. Fortsätt där arbetet faktiskt stod.

## RYMDÄVENTYR
- Rymdäventyr ska kännas stora, visuella och unika.
- Undvik generiska aliens som "vänlig ras som alltid hjälper till". Skapa unika kulturer, regler och platser.
- Ett rymdskepp som kraschat eller fångats i ett svart hål ska leda till riktiga problem och kreativa lösningar – inte triviala småsysslor.
- Ingen onödig "vi råkade bara ramla in i ett svart hål" i varje kapitel. Variation krävs.

## TIDSRESOR
- Tidsresor till historiska årtal ska kännas farliga, annorlunda och betydelsefulla.
- Barnen ska möta riktiga dilemman, faror eller mysterier – inte bara hjälpa till med små vardagssysslor, om inte barnet själv ber om just det.
- Historiska detaljer ska vara enkla men trovärdiga.

## UTDATA
- Skriv endast berättelsetexten.
- Inga rubriker som "Kapitel 1" om inte användaren tydligt vill det.
- Inga punktlistor, inga "Lärdomar:", inga förklaringar om varför du skrev som du gjorde.
- Ingen överdriven upprepning av känslofraser som "hjärtat slog snabbare", "han var nervös" i varje scen – variera uttrycken och fokusera på handlingen.
`.trim();
}

function shorten(text, maxLen) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

// Post-filter: klipper bort dina hatfraser om de ändå smiter igenom
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
