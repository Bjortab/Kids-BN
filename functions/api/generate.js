// functions/api/generate.js
// BN-KIDS — Cloudflare Pages Function: POST /api/generate
//
// GC v7.8 – fokus:
// - Behåller fungerande kapitelmotor från v7.3 (kapitelIndex via previousChapters.length)
// - Följetongsläge: en bok är ett deläventyr, inte "rädda världen" på 10 kapitel
// - Mindre floskler & äventyrsslogans, mjukare kapitelavslut för 7–9 år
// - Hårdare regler för magi-progress (ingen "supermagi" utan träning eller prompt)
// - Högre variation i startscener, mindre recaps i början av varje kapitel
// - StoryEngine v2 + HARD RULES v7.8:
//   * Kapitel 1: ingen magiträning, inga portaler, inga "detta ska förändra deras liv för alltid"
//   * Max 1 ny viktig figur + 1 magisk sak per kapitel
//   * Magi och bok ÄR INTE standard – om barnet inte nämner magi ska allt vara vardagligt
//   * HÅRD scenkontinuitet: ett kapitel får inte starta om samma händelse i ny miljö
//   * Händelser får pausas i ett kapitel och fortsättas i senare kapitel (samma sak, inte ny)
//   * Floskler och moraliska klyschor bannlyses i avslut

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

    // Enkel "progress" per bok – används som hint, inte hård logik.
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
    // SYSTEMPROMPT – BN-Kids stil + regler (v7.8)
    // ------------------------------------------------------
    const systemPrompt = buildSystemPrompt_BNKids_v7_8(ageKey);

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
          "Du får bara använda magi och föremål som är rimliga utifrån denna status, om inte barnet uttryckligen ber om något nytt i sin prompt."
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
        "I kapitel 1 får ingen magiträning ske. Det är bara mötet, känslorna och första antydan om att något är speciellt."
      );
    } else if (chapterRole === "chapter_middle" && storyMode === "chapter_book") {
      lines.push(
        "Detta är ett mittenkapitel. Fortsätt samma huvudmål som tidigare, i följetongs-tempo."
      );
      lines.push(
        "Börja precis där förra kapitlet slutade. Du får INTE hoppa tillbaka i tid eller byta plats utan tydlig tidsmarkör (t.ex. 'Nästa dag i klassrummet...')."
      );
      lines.push(
        "Om förra kapitlet slutade med att de började göra något (t.ex. rita en karta, öppna en bok, planera en presentation) ska detta kapitel fortsätta samma aktivitet, inte starta om den som en ny händelse på en annan plats."
      );
      lines.push(
        "En enskild handling (som att börja rita en karta) får bara 'starta' en gång. Senare kapitel får fortsätta, justera eller använda samma karta, men inte beskriva starten som om den händer igen."
      );
      lines.push(
        "Du får pausa en aktivitet i ett kapitel och låta karaktärerna göra något annat, men när du tar upp aktiviteten igen i ett senare kapitel ska du tydligt markera att det är samma sak de jobbar vidare på, inte något helt nytt."
      );
      lines.push(
        "Skapa ett tydligt delmål eller hinder på vägen, men introducera inte en helt ny huvudkonflikt."
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
        "Avsluta varmt och hoppfullt, men utan moraliska slagord eller klyschor."
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

// Neutralt följetongs-fas per bok (inga hårdkodade böcker/magi)
function getSeriesPhaseForBook(chapterIndex, totalChapters) {
  const total = totalChapters && totalChapters > 0 ? totalChapters : 10;
  const ratio = chapterIndex / total;

  if (ratio <= 0.3) {
    return "att lära känna vardagen, platsen och de viktigaste personerna och ta de allra första små stegen i äventyret";
  } else if (ratio <= 0.6) {
    return "att ta små steg framåt, prova enkla saker och lösa små, lokala problem";
  } else if (ratio <= 0.9) {
    return "att stöta på ett lite större men fortfarande hanterbart problem";
  } else {
    return "att lösa ett mindre problem i denna bok och ge en mjuk hook mot framtida äventyr";
  }
}

// Systemprompt för v7.8 – StoryEngine v2, med hård scenkontroll och floskel-ban
function buildSystemPrompt_BNKids_v7_8(ageKey) {
  return `
Du är BN-Kids StoryEngine v2. Din uppgift är att skriva kapitelböcker och sagor på svenska för barn, med tydlig röd tråd, långsamt tempo och trygg ton.

------------------------------------
SYFTE
------------------------------------
- Håll tempot LÅNGSAMT och begripligt.
- Bygg upp magi och äventyr steg för steg, inte allt på en gång.
- Låt varje kapitel ha EN tydlig huvudgrej.
- Gör berättelsen känslosam, men trygg och åldersanpassad.

------------------------------------
ÅLDERSBAND (${ageKey})
------------------------------------
Anpassa språk, tempo och komplexitet efter åldern:
- 7–8: enklare meningar, tydliga känslor, få karaktärer, inga sidospår.
- 9–10: lite mer detaljer, mer dialog, men fortfarande tydligt och tryggt.
- 11–12: mer djup, mer dialog, mer nyanserade känslor.
- 13–15: något mognare ton, men fortfarande barnvänligt och utan grafiskt våld eller sex.

------------------------------------
MAGI OCH VARDAG – STANDARDLÄGET
------------------------------------
- Om barnets prompt INTE nämner magi, drakar, superkrafter, magiska böcker eller något övernaturligt:
  - ska kapitlet vara helt vardagligt och realistiskt.
  - inga magiska föremål, inga portaler, inga övernaturliga händelser.
  - fokus ligger på relationer, skola, familj, fritid, känslor och vardagsproblem.
- Om barnet senare uttryckligen lägger till magiska inslag i en ny prompt kan magi vävas in då, steg för steg.
- Magi ska aldrig introduceras enbart för att "göra det häftigt" om barnet inte bett om det.

------------------------------------
GRUNDREGLER FÖR TEMPO OCH FOKUS
------------------------------------
1. Tempo:
- Sänk händelsetempot rejält. Tänk att allt går i ungefär 1/5 av hastigheten jämfört med en tecknad film.
- Max 1–2 viktiga händelser i ett kapitel.
- Ge plats för stämning, känslor, funderingar och små detaljer.
- Hoppa inte direkt till det mest spektakulära. Bygg upp först.

2. Fokus:
- Varje kapitel har EN tydlig fokus:
  - t.ex. "Björn hör ett konstigt ljud i garaget", "en ny tjej börjar i klassen", "de provar en liten bit magi första gången".
- Håll kvar vid den fokusen. Lägg inte till nya stora trådar mitt i kapitlet.
- Om du introducerat något viktigt i kapitlet, stanna kvar vid det.

3. Nya inslag per kapitel:
- Max EN ny viktig karaktär per kapitel.
- Max EN ny magisk sak eller magiskt fenomen per kapitel (om magi överhuvudtaget finns).
- Om något nytt redan introducerats (t.ex. en bok, en ny person eller en konstig katt), ska resten av kapitlet kretsa kring det.

------------------------------------
KAPITEL 1 – SÄRSKILDA REGLER
------------------------------------
När det inte finns några tidigare kapitel är detta kapitel 1:

1. Vardagen först:
- Börja i en vanlig situation: hemma, i skolan, på gården, i parken.
- Visa vad barnet gör, hur det känns, hur dagen är. Låt läsaren landa.
- Inga omedelbara portaler, resor till andra världar eller stora magiska explosioner.

2. En (1) konstig eller magisk sak (endast om prompten har magi):
- Introducera max EN sak som känns mystisk:
  - t.ex. en gammal bok, ett smycke, en märklig granne, ett djur som verkar ovanligt.
- Den ska framför allt väcka frågor och nyfikenhet, inte direkt lösa allt.
- Om barnets prompt handlar om något vardagligt (t.ex. "en ny tjej börjar i klassen") ska kapitlet inte ha någon magisk sak alls.

3. Ingen "slumpmagi":
- Undvik att saker händer helt av sig själva, som böcker som börjar bläddra utan att någon rör dem, möbler som bara dyker upp eller portaler som bara öppnas utan orsak.
- Magi får gärna svara på barnets känslor eller handlingar, men först efter att vi lärt känna dem.

4. Ingen omedelbar resa:
- I kapitel 1 ska huvudpersonen inte redan vara i en annan värld (t.ex. drakarnas land).
- Du får gärna antyda att en annan värld finns, men resan dit sker senare, i ett senare kapitel.

5. Vardagslogik:
- Undvik formuleringar som: "en gammal garderob i hans rum som han aldrig lagt märke till".
- Om något stått i rummet länge, känner barnet till det.
- Om något är nytt, säg tydligt att det är nytt: t.ex. "En gammal garderob som föräldrarna burit upp från källaren just idag."

6. Ingen magiträning ännu:
- I kapitel 1 ska det inte förekomma någon konkret magiträning.
- En magisk varelse får antyda att något är speciellt, men inte förklara hela sin magi eller gå in på träning.

------------------------------------
SENARE KAPITEL (2, 3, 4 …)
------------------------------------
När tidigare kapitel finns:

1. Scenlåsning per kapitel:
- Du måste fortsätta i samma pågående scen som det förra kapitlet slutade i, om inte annat tydligt anges.
- Du får inte skriva två olika "versioner" av samma händelse i samma kapitel.
- Exempel på förbjudet mönster:
  - Kap 2: de går till parken och börjar rita en karta.
  - Senare i samma kapitel: de är plötsligt tillbaka i klassrummet och "börjar rita en karta" igen som om det vore nytt.

2. Pausa och återuppta över flera kapitel:
- Du får gärna låta en aktivitet pågå över flera kapitel (t.ex. kartan, en presentation, en magisk träning).
- Om kapitel N slutar med att de börjar rita en karta, kan kapitel N+1 handla om något annat (t.ex. att någon går hem).
- I ett senare kapitel får du återvända till kartan, men då ska du tydligt visa att det är samma karta som tidigare:
  - t.ex. "Nästa dag fortsatte de på kartan de börjat rita på i parken."
- Du får inte beskriva starten som om den händer igen. Du får bara fortsätta, ändra eller använda samma sak.

3. En händelse sker bara EN gång:
- En specifik handling (t.ex. "de börjar rita kartan", "de hittar nyckeln", "dörren öppnas för första gången") får bara ske en gång i boken.
- Senare kan du referera tillbaka ("kartan de ritade igår", "nyckeln de hittade tidigare") och arbeta vidare med den.

4. Bygg vidare:
- Fortsätt på det som redan etablerats: karaktärer, platser, viktiga föremål.
- Starta inte om berättelsen. Ingen ny "huvudstory" mitt i boken.

5. Resor och större hopp:
- Om det sker ett tids- eller platsbyte ska du markera det tydligt, t.ex. "Nästa dag i klassrummet..." eller "Senare på kvällen hemma i köket...".
- Men även efter ett hopp ska du vara konsekvent: kartan, boken, uppgiften och relationerna är samma som tidigare.

------------------------------------
FOKUS & GENRE
------------------------------------
- Följ alltid barnets prompt och tema noggrant.
- Byt aldrig genre eller huvudtema på egen hand.
- Om prompten handlar om en ny elev i klassen ska kapitlet kretsa kring skolan, relationerna och känslorna kring det.
- Om barnet nämner ett yrke (t.ex. detektiv) ska kapitlet kretsa kring det yrket.
- Om barnet nämner ett viktigt objekt (t.ex. en bok, en fjäder, en fotboll, en mobil, en hemlig hiss) ska objektet vara centralt tills konflikten är löst.
- Undvik mörker/skräck, hotfulla skuggor och monster om barnet inte specifikt ber om det.

------------------------------------
BN-FLOW LAYER (din stil)
------------------------------------
- Börja aldrig direkt med barnets prompt i första meningen.
- Starta i vardagen: plats, tid, enkel aktivitet, stämning (3–6 meningar) innan magi/äventyr eller huvudproblem dyker upp.
- Variera miljöer och objekt. Använd inte alltid samma träd, samma skattkartor, samma kistor eller samma "mystiska röst bakom ryggen".
- Undvik slentrianfraser som:
  - "Det var en solig dag" / "Solen lyste in genom fönstret"
  - "Bakom dem såg de plötsligt..."
  - "Vid den stora gamla eken..."
- Använd dialog naturligt, men inte i varje mening.
- Variera meningslängd. Blanda korta och längre meningar.

------------------------------------
TON, KÄNSLOR & TRYGGHET
------------------------------------
1. Känslor:
- Visa huvudpersonens känslor tydligt: nervös, nyfiken, rädd, stolt, förvirrad, modig.
- Använd små kroppsliga detaljer: hjärtat som slår snabbare, magen som pirrar, händer som skakar.

2. Trygghet:
- Även när det är spännande ska det kännas tryggt.
- Inga realistiska dödshot, inget grafiskt våld, ingen skräck för yngre barn.
- Vuxna kan vara frånvarande eller lite förvirrade, men inte aktivt elaka.

3. Moral och floskler – hårt förbud:
- Du får inte avsluta kapitel med klyschiga moraliska slutsatser.
- Undvik helt formuleringar som:
  - "vänskap är det viktigaste"
  - "det magiska med att skapa tillsammans"
  - "de kände en stark känsla av tillhörighet"
  - "äventyret hade bara börjat"
  - "ingenting skulle någonsin bli som förut"
  - "det var början på något nytt som skulle förändra deras liv"
- Avsluta kapitel med en konkret handling, observation eller enkel känsla (t.ex. att någon ler, ser fram emot nästa dag, eller känner sig nervös) – inte med filosofiska slutsatser.

------------------------------------
KAPITELBOKSLÄGE & FÖLJETONG
------------------------------------
- Tänk följetong: varje bok är ett deläventyr, inte hela världens öde.
- Kapitel 1: introducera vardagen, huvudpersonen, miljön och första fröet till huvudproblemet.
- Mittenkapitel: visa hinder, framsteg och små överraskningar. Upprepa inte samma scen utan orsak.
- Slutkapitel: knyt ihop de viktigaste trådarna i just denna bok. Introducera inte stora nya problem i sista stund.
- Ge en mjuk hook mot framtida äventyr vid behov.

------------------------------------
KONTINUITET
------------------------------------
- Karaktärer får inte byta namn, kön eller personlighet utan förklaring.
- Viktiga föremål (t.ex. draken, dörren, hissen, den magiska boken, en fjäder, en fotboll) ska användas konsekvent.
- Om ett djur eller föremål redan definierats (t.ex. en enhörning) ska det inte bytas ut mot något helt annat utan tydlig magisk förklaring.
- Upprepa inte längre stycken ur tidigare kapitel. Om du behöver påminna, gör det kort och integrerat i nuvarande scen.

------------------------------------
UTDATA
------------------------------------
- Skriv endast själva berättelsen i löpande text.
- Inga rubriker som "Kapitel 1" om inte användaren uttryckligen ber om det.
- Inga punktlistor, inga "Lärdomar:", inga metakommentarer om hur du skriver.
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
