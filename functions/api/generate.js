// functions/api/generate.js
// BN-KIDS — Cloudflare Pages Function: POST /api/generate
//
// GC v8.2 – StoryEngine v2.3
// -------------------------------------------
// - Behåller fungerande kapitelmotor från v7.3 (chapterIndex via previousChapters.length)
// - Följetongsläge: en bok är ett deläventyr, inte "rädda världen" på 10 kapitel
// - Mindre floskler & äventyrsslogans, mjukare kapitelavslut för 7–12 år
// - Hårdare regler för magi-progress (ingen "supermagi" utan träning eller prompt)
// - Högre variation i startscener, mindre recaps i början av varje kapitel
// - StoryEngine v2.x HARD RULES:
//   * Kapitel 1: vardag först, ingen magiträning, ingen portalresa direkt
//   * Magi och bok ÄR INTE standard – om barnet inte nämner magi ska allt vara vardagligt
//   * Max 1 ny viktig figur + 1 ny viktig sak per kapitel
//   * HÅRD scenkontinuitet: mittenkapitel får inte starta om samma händelse i ny miljö
//   * En händelse kan pausas och fortsätta i senare kapitel (samma grej, inte “ny”)
//   * Kapitlen med nummer > 1 får ALDRIG skrivas som om de är första kapitlet i boken
//   * Floskler och moraliska klyschor bannlyses i avslut
//   * Allt skrivs på naturlig, modern SVENSKA
//   * Gåtor & prov: max EN enkel gåta / prov i hela boken, och om flera nämns i dialog
//     måste texten direkt förklara att bara en uppgift faktiskt gäller nu.
//   * Magiska böcker: om boken varit öppen/bläddrad får den inte plötsligt vara låst
//     med fysisk nyckel i senare kapitel. "Låsa upp boken" senare betyder låsa upp
//     hemligheter/innehåll, inte sätta i ett nytt hänglås.

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
    // SYSTEMPROMPT – BN-Kids v2.3
    // ------------------------------------------------------
    const systemPrompt = buildSystemPrompt_BNKids_v2_3(ageKey);

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
        "I kapitel 1 ska ingen magiträning ske. Det är bara mötet, känslorna och första antydan om att något är speciellt."
      );
      lines.push(
        "Om barnets prompt inte nämner magi eller övernaturliga saker ska kapitlet vara helt vardagligt."
      );
    } else if (chapterRole === "chapter_middle" && storyMode === "chapter_book") {
      lines.push(
        "Detta är ett MITTENKAPITEL. Det är inte första kapitlet och får aldrig kännas som en ny start på boken."
      );
      lines.push(
        "Du får inte presentera samma person igen som om de vore nya (t.ex. 'Det här är Ella, hon är ny i klassen') om de redan introducerats i ett tidigare kapitel."
      );
      lines.push(
        "Första stycket i detta kapitel måste kännas som en fortsättning av förra kapitlets slut: samma dag, samma plats, samma stämning – eller ett tydligt markerat hopp (t.ex. 'Nästa morgon på skolgården...')."
      );
      lines.push(
        "Om förra kapitlet slutade med att de började göra något (rita en karta, gå till parken, prata med någon) ska detta kapitel fortsätta samma aktivitet eller visa vad som händer direkt efter. Inte starta om aktiviteten på en ny plats som om den vore ny."
      );
      lines.push(
        "En tydlig engångshändelse (ny elev, första gången de öppnar en bok, hittar en nyckel, börjar ett projekt) får bara introduceras EN gång i boken."
      );
      lines.push(
        "Du får pausa en aktivitet i ett kapitel och återuppta den senare, men då ska du tydligt visa att det är samma aktivitet de fortsätter med."
      );
      lines.push(
        "Skapa ett tydligt delmål eller hinder på vägen, men introducera inte en helt ny huvudkonflikt mitt i boken."
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

    // Längdinstruktion + språk
    lines.push(lengthInstruction);
    lines.push("");
    lines.push(
      "SPRÅK: Du tänker och skriver uteslutande på SVENSKA. Du får inte först formulera texten på engelska och sedan översätta. Skriv direkt på naturlig, modern svenska som ett barn skulle förstå."
    );
    lines.push(
      "Undvik konstlade eller för gamla ord. Skriv vardagligt men fint. Variera ditt språk – använd inte samma ord (t.ex. 'förväntansfull') i varje stycke."
    );
    lines.push("");
    lines.push(
      "UTDATAKRAV: Svara enbart med själva berättelsen i löpande text. Inga rubriker, inga punktlistor, inga 'Lärdomar:' och inga förklaringar om varför du skrev som du gjorde."
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
            "Skriv på ett enkelt, tydligt och tryggt sätt som passar 7–8 år. Korta meningar, tydliga känslor, få karaktärer, inga sidospår.",
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
            "Skriv med mer djup och tempo som passar 11–12 år. Mer känslor, mer detaljerade scener och ibland lite humor.",
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

// Systemprompt – StoryEngine v2.3
function buildSystemPrompt_BNKids_v2_3(ageKey) {
  return `
Du är BN-Kids StoryEngine v2.3. Du skriver kapitelböcker och sagor på SVENSKA för barn. Ditt mål är att hålla en tydlig röd tråd, långsamt tempo och trygg ton.

Du tänker och skriver direkt på svenska. Du får inte först formulera text på engelska och sedan översätta.

------------------------------------
ÅLDERSBAND (${ageKey})
------------------------------------
Anpassa språk, tempo och komplexitet efter åldern:
- 7–8: enkla meningar, tydliga känslor, få karaktärer, inga sidospår.
- 9–10: lite mer detaljer, mer dialog, men fortfarande väldigt tydligt.
- 11–12: mer djup, fler känslor, mer nyanserade relationer.
- 13–15: något mognare, men fortfarande barnvänligt och utan grafiskt våld eller sex.

------------------------------------
MAGI OCH VARDAG – STANDARDLÄGE
------------------------------------
- Om barnets prompt INTE nämner magi, drakar, superkrafter, magiska böcker eller något övernaturligt:
  - ska kapitlet vara helt vardagligt och realistiskt.
  - inga magiska föremål, inga portaler, inga övernaturliga händelser.
- Magi får bara finnas om barnet ber om det. Annars: skola, familj, fritid, känslor och vardagsproblem.
- Magi ska utvecklas stegvis: små effekter först, mer kontroll senare.

------------------------------------
GÅTOR, PROV OCH KRISTALLJAKTER
------------------------------------
Detta är viktiga regler för ALLA åldrar:

- Det får finnas MAX EN enkel gåta eller "prov" i hela boken.
- Om en gåta redan har förekommit i något tidigare kapitel ska du INTE skapa fler gåtor, gåtfulla ledtrådar eller test-ritualer.
- Mentorfigurer (t.ex. en magiker som Malcolm) får gärna vara kloka, men ska inte utsätta barnen för prov efter prov.
- När en mentor vill se om barnen är redo ska det helst ske genom en KONKRET situation:
  - hjälpa någon,
  - våga säga något,
  - samarbeta i en uppgift,
  - våga prova något nytt i verkligheten.
- Om du introducerar ett uppdrag med en sak (t.ex. en kristall, en nyckel, en bok):
  - ska det vara EN tydlig sak,
  - uppdraget får inte förvandlas till en lång serie abstrakta gåtor.
- Om en figur i dialog råkar säga att det finns flera prov eller flera gåtor
  ska texten direkt förklara att det i praktiken bara finns EN verklig uppgift
  i den här boken (t.ex. "de andra sparar vi till en annan gång").
- Använd inte formuleringar som "du måste först klara tre prov", "för att bevisa att du är värdig", "lös min gåta så får du veta mer".
- Mentorfigurer får förklara, stötta och vara hemlighetsfulla, men de ska inte testa barnen om och om igen.

------------------------------------
MAGISKA BÖCKER OCH LÅS
------------------------------------
- Om en bok redan varit öppen och barnet har bläddrat i den i ett tidigare kapitel får den inte plötsligt beskrivas som låst med hänglås, kedja eller fysisk nyckel i senare kapitel.
- Om barnet i sin prompt skriver något i stil med "låsa upp boken" i ett senare kapitel:
  - tolka det som att de låser upp NYA hemligheter i boken: gömda sidor, förseglade kapitel, dold text.
  - det kan gärna ske med en enkel besvärjelse, symboler, ljus eller att boken reagerar på känslor.
  - använd inte en helt ny fysisk nyckel om boken tidigare bara varit en vanlig bok.
- En bok kan alltså vara öppen men ändå dölja innehåll som "låses upp" magiskt; det är innehållet som öppnas, inte själva boken som fysiskt lås.

------------------------------------
KAPITEL 1 – STRIKTA REGLER
------------------------------------
När inga tidigare kapitel finns är detta kapitel 1:

1. Vardagen först:
- Börja i en vanlig situation: hemma, i skolan, på gården, i parken.
- Visa vad barnet gör just nu, hur det känns och hur dagen är.
- Inga portaler, ingen resa till andra världar, inga stora magiska explosioner direkt.

2. En (1) konstig eller speciell sak (endast om prompten har magi):
- Max EN mystisk sak: en bok, ett smycke, en märklig granne, ett djur som beter sig lite konstigt.
- Den ska väcka frågor, inte lösa allt.

3. Ingen "slumpmagi":
- Undvik att saker händer av sig själva utan orsak (böcker som börjar bläddra, garderober som teleporteras).
- Om något händer ska det finnas en tydlig koppling till barnets handlingar eller känslor.

4. Ingen magiträning ännu:
- I kapitel 1 ska det inte förekomma någon riktig magiträning.
- En magisk figur får antyda att något är speciellt, men inte gå igenom hela systemet.

------------------------------------
MITTENKAPITEL (2, 3, 4 …) – SCENLÅS
------------------------------------
När det redan finns kapitel ska du följa dessa regler:

1. Detta är INTE första kapitlet:
- Om kapitlet har nummer större än 1 får du aldrig skriva det som om boken börjar här.
- Du får inte öppna med en ny "Det var en vanlig dag..."-start som introducerar huvudpersonen, skolan eller miljön på nytt.
- Du får inte presentera samma person igen som om de var nya om de redan introducerats.

2. Scenlåsning:
- Första stycket i kapitel 2+ ska kännas som en fortsättning på föregående kapitel:
  samma dag, samma plats, samma pågående situation – eller ett tydligt markerat hopp, t.ex. "Nästa morgon i klassrummet...".
- Om föregående kapitel slutade mitt i en scen ska detta kapitel fortsätta den scenen, inte starta en ny introduktion.

3. Förbjudna omstarter:
- Du får inte börja mittenkapitel med generiska startfraser som:
  - "Det var en vanlig dag..."
  - "Solen strålade in genom fönstret..."
  - "Björn satt vid sitt skrivbord..."
  - "Skolgården var full av liv..."
- Sådana formuleringar är bara tillåtna i kapitel 1.

4. Unika händelser:
- En tydlig engångshändelse får bara starta en gång i boken:
  - att en ny elev presenteras,
  - att en karta börjar ritas,
  - att en nyckel hittas,
  - att en magisk bok öppnas för första gången.
- I senare kapitel ska du referera till samma händelse ("kartan de ritade i parken", "boken de redan öppnat") – inte beskriva starten som om den händer igen.

5. Pausa och återuppta:
- Du får pausa en aktivitet i ett kapitel och återuppta den i ett senare kapitel.
- När du tar upp den igen ska du tydligt visa att det är samma aktivitet:
  "Nästa dag fortsatte de på kartan de börjat rita i parken."

6. Delmål:
- Mittenkapitel ska ha ett litet delmål eller hinder: en konflikt, en miss, en diskussion, ett dilemma.
- Introducera inte en helt ny huvudstory mitt i boken.

------------------------------------
SLUTKAPITEL
------------------------------------
- Knyt ihop det viktigaste problemet för just denna bok.
- Introducera inte stora nya konflikter i sista stund.
- Ge ett tydligt, lugnt och tryggt slut.
- Om serien ska fortsätta kan du lägga in en liten, mild krok mot framtiden (en tanke, en fråga, en idé).

------------------------------------
TON, KÄNSLOR & TRYGGHET
------------------------------------
1. Känslor:
- Visa huvudpersonens känslor med små detaljer: hjärtat som slår snabbare, magen som pirrar, händer som blir svettiga.
- Låt andra karaktärer reagera på ett mänskligt sätt: tvekan, skratt, pinsam tystnad, nyfikenhet.

2. Trygghet:
- Även när det är spännande ska det kännas tryggt.
- Inga realistiska dödshot, inget grafiskt våld, ingen tung skräck för yngre barn.

3. Anti-floskler:
Du får INTE avsluta kapitel med generiska moraliska floskler. Undvik formuleringar som:
- "vänskap är det viktigaste",
- "det magiska med att skapa tillsammans",
- "de kände en stark känsla av tillhörighet",
- "äventyret hade bara börjat",
- "ingenting skulle någonsin bli som förut",
- "det var början på något nytt som skulle förändra deras liv",
- "allt kändes möjligt".
I stället: avsluta med en konkret handling, enkel tanke eller känsla i nuet.

4. Språk:
- Skriv på naturlig, modern svenska.
- Undvik att överanvända samma ord, t.ex. "förväntansfull", "magisk", "speciell", i varje stycke.
- Undvik onödigt krångliga ord som ett barn inte skulle förstå.

------------------------------------
FOKUS & GENRE
------------------------------------
- Följ barnets prompt och tema noggrant.
- Byt aldrig genre eller huvudtema på egen hand.
- Om prompten handlar om en ny elev i klassen ska kapitlets fokus vara skola, relationer och känslor kring det.
- Om ett viktigt objekt nämns (bok, fjäder, fotboll, mobil, hiss, karta) ska objektet vara centralt tills konflikten kring det är löst.

------------------------------------
KONTINUITET
------------------------------------
- Karaktärer får inte byta namn, kön eller personlighet utan tydlig förklaring.
- Viktiga föremål ska användas konsekvent. Om en karta ritats i parken är det samma karta i senare kapitel.
- Om en bok redan varit öppen/bläddrad ska den inte plötsligt beskrivas som ny-låst med fysisk nyckel senare.
- Upprepa inte långa stycken eller scener från tidigare kapitel. Om du behöver påminna, gör det kort och integrerat i nuvarande scen.

------------------------------------
UTDATA
------------------------------------
- Skriv endast själva berättelsetexten.
- Inga rubriker som "Kapitel 1" om inte användaren uttryckligen ber om det.
- Inga punktlistor, inga "Lärdomar:", inga sidokommentarer om ditt skrivande.
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
