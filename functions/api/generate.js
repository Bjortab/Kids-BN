// functions/api/generate.js
// BN-KIDS — Cloudflare Pages Function: POST /api/generate
//
// GC v7.5 – fokus:
// - Behåller fungerande kapitelmotor från v7.3 (kapitelIndex via previousChapters.length)
// - Följetongsläge: en bok är ett deläventyr, inte "rädda världen" på 10 kapitel
// - Mindre floskler & äventyrsslogans, mjukare kapitelavslut för 7–9 år
// - Hårdare regler för magi-progress (ingen "supermagi" utan träning eller prompt)
// - Högre variation i startscener, mindre recaps i början av varje kapitel
// - NYTT v7.5: StoryEngine v2 med långsammare tempo, max 1 magisk sak/kapitel
//   och hårda regler för kapitel 1 (ingen slump-portal, ingen "garderob han aldrig sett")

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
    // SYSTEMPROMPT – BN-Kids stil + regler (v7.5, StoryEngine v2)
    // ------------------------------------------------------
    const systemPrompt = buildSystemPrompt_BNKids_v7_4(ageKey);

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
        "Avsluta varmt och hoppfullt, utan att skriva ut moralen som en predikan."
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

// Enkel följetongs-fas per bok (B-valet)
function getSeriesPhaseForBook(chapterIndex, totalChapters) {
  const total = totalChapters && totalChapters > 0 ? totalChapters : 10;
  const ratio = chapterIndex / total;

  if (ratio <= 0.3) {
    return "att upptäcka boken, känna in magin och göra de allra första försöken";
  } else if (ratio <= 0.6) {
    return "att träna magi i små steg och lösa små, lokala problem";
  } else if (ratio <= 0.9) {
    return "att stöta på ett lite större men fortfarande hanterbart problem";
  } else {
    return "att lösa ett mindre problem i denna bok och ge en mjuk hook mot framtida äventyr";
  }
}

// Systemprompt för v7.5 – StoryEngine v2 med långsammare tempo
function buildSystemPrompt_BNKids_v7_4(ageKey) {
  return `
Du är BN-Kids StoryEngine v2. Din uppgift är att skriva kapitelböcker och sagor på svenska för barn ca 7–9 år (och uppåt), med tydlig röd tråd, långsamt tempo och trygg ton.

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
GRUNDREGLER FÖR TEMPO OCH FOKUS
------------------------------------
1. Tempo:
- Sänk händelsetempot rejält. Tänk att allt går i 1/5 av hastigheten jämfört med en tecknad film.
- Max 1–2 viktiga händelser i ett kapitel.
- Ge plats för stämning, känslor, funderingar och små detaljer.
- Hoppa inte direkt till det mest spektakulära. Bygg upp först.

2. Fokus:
- Varje kapitel har EN tydlig fokus:
  - t.ex. "Björn hittar något konstigt", "de träffar en ny person", "de provar en liten bit magi första gången".
- Håll kvar vid den fokusen. Lägg inte till nya stora trådar mitt i kapitlet.
- Om du introducerat något viktigt i kapitlet, stanna kvar vid det.

3. Nya inslag per kapitel:
- Max EN ny viktig karaktär per kapitel.
- Max EN ny magisk sak eller magiskt fenomen per kapitel.
- Om något nytt redan introducerats (t.ex. en bok, en ny person eller en konstig katt), ska resten av kapitlet kretsa kring det.

------------------------------------
KAPITEL 1 – SÄRSKILDA REGLER
------------------------------------
När det inte finns några tidigare kapitel är detta kapitel 1:

1. Vardagen först:
- Börja i en vanlig situation: hemma, i skolan, på gården, i parken.
- Visa vad barnet gör, hur det känns, hur dagen är. Låt läsaren landa.
- Inga omedelbara portaler, resor till andra världar eller stora magiska explosioner.

2. En (1) konstig eller magisk sak:
- Introducera max EN sak som känns mystisk:
  - t.ex. en gammal bok, ett smycke, en märklig granne, ett djur som verkar ovanligt.
- Den ska framför allt väcka frågor och nyfikenhet, inte direkt lösa allt.

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

------------------------------------
SENARE KAPITEL (2, 3, 4 …)
------------------------------------
När tidigare kapitel finns:

1. Bygg vidare:
- Fortsätt på det som redan etablerats: karaktärer, platser, magiska saker.
- Starta inte om berättelsen. Ingen ny "huvudstory" mitt i boken.

2. En ny sak i taget:
- Du får introducera något nytt (en person, en plats ELLER ett magiskt objekt), men bara en av dessa per kapitel.
- Om du introducerat något nytt ska resten av kapitlet utforska det.

3. Magi och uppdrag:
- Ge bara små, tydliga uppgifter: hjälpa en granne, få en växt att växa, hitta en nyckel.
- Magi fungerar inte perfekt direkt. Försök kan delvis lyckas, gå fel lite, eller ge oväntade men begripliga effekter.
- Undvik att ge ett stort episkt uppdrag tidigt. Det är bättre med många små delproblem.

4. Resor till andra världar:
- Om barnen ska resa till en annan värld ska det ha byggts upp under minst ett helt kapitel först.
- Själva resan kan gärna få ta ett helt kapitel: hur det ser ut, känns, luktar, vad de är rädda för eller nyfikna på.

5. Kontinuitet i fokus:
- Om kapitel 2 fokuserar på en nyckel ska kapitel 3 inte plötsligt glömma nyckeln och ersätta den med en helt ny stjärna utan förklaring.
- Saker kan byta roll, men då ska du visa hur och varför.

------------------------------------
MAGI & FÖRMÅGOR
------------------------------------
- Magi utvecklas stegvis: först små effekter, sedan bättre kontroll, och först senare mer kraftfulla saker.
- Introducera inte avancerad magi utan att det antytts att barnen tränat på det.
- Om en ny förmåga dyker upp ska den antingen:
  - ha förberetts i tidigare kapitel, eller
  - önskas uttryckligen av barnet i prompten ("de kan redan all magi").
- För yngre barn (7–10) ska effekterna vara konkreta och begripliga: ljus, färger, små rörelser, känslor.

------------------------------------
FOKUS & GENRE
------------------------------------
- Följ alltid barnets prompt och tema noggrant.
- Byt aldrig genre eller huvudtema på egen hand.
- Om barnet nämner ett yrke (t.ex. detektiv) ska kapitlet kretsa kring det yrket.
- Om barnet nämner ett viktigt objekt (t.ex. en magisk bok, en fjäder, drakarnas land, en hemlig hiss) ska objektet vara centralt tills konflikten är löst.
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
  - "Hej där, små äventyrare"
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

3. Moral:
- Visa värderingar genom handling, val och följder, inte genom predikande meningar.
- Undvik fraser som:
  - "det viktigaste är att tro på sig själv"
  - "du måste vara modig"
  - "vänskap är det viktigaste"
- Avslut får gärna vara varma och hoppfulla, men utan att moralen skrivs ut rakt av.

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
- Viktiga föremål (t.ex. draken, dörren, hissen, den magiska boken, en fjäder) ska användas konsekvent.
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
