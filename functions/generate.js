// functions/generate.js
// Pages Function: POST /api/generate
// BN-KIDS GC v6.1 – fokus på:
// - Hårdare kapitelkontinuitet (fortsätt samma berättelse, ingen reboot)
// - Mindre klyschor (dörr+nyckel, “solen värmde ansiktet”, osv.)
// - Mindre moral-floskler, mer “visa” än “berätta”
// - Ton och flow närmare våra manuella exempel

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

    // worldState från WS-motorn / frontenden
    const worldState = body.worldState || {};
    const wsMeta = worldState.meta || {};
    const prevChapters = Array.isArray(worldState.previousChapters)
      ? worldState.previousChapters
      : [];

    // Bestäm storyMode robustare:
    // - Om vi har tidigare kapitel → kapitelbok
    // - Om body.storyMode säger "chapter_book" → kapitelbok
    // - Annars single_story
    let storyMode =
      body.storyMode ||
      body.story_mode ||
      wsMeta.storyMode ||
      (prevChapters.length > 0 ? "chapter_book" : "single_story");

    if (storyMode !== "chapter_book" && prevChapters.length > 0) {
      storyMode = "chapter_book";
    }

    const chapterIndex = Number(
      body.chapterIndex ||
        worldState.chapterIndex ||
        1
    );

    const totalChapters =
      Number(body.totalChapters || wsMeta.totalChapters) || 8;

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
    const { lengthInstruction, maxTokens } =
      getLengthInstructionAndTokens(ageKey, lengthPreset);

    // ------------------------------------------------------
    // SYSTEMPROMPT – core + flow + kapitel + anti-klyscha
    // ------------------------------------------------------
    const systemPrompt = buildSystemPrompt_BNKids(ageKey);

    // ------------------------------------------------------
    // USERPROMPT – barnets idé + worldstate + kapitelroll
    // ------------------------------------------------------

    const previousSummary =
      worldState.previousSummary ||
      worldState.summary ||
      "";

    const isFirstChapter = chapterIndex <= 1;
    const isFinalChapter = chapterIndex >= totalChapters - 1;

    const chapterRole = (() => {
      if (storyMode !== "chapter_book") return "single_story";
      if (isFirstChapter) return "chapter_1";
      if (isFinalChapter) return "chapter_final";
      return "chapter_middle";
    })();

    // Kompakt historik (senaste 2–3 kapitel, inte allt)
    const compactHistory = prevChapters
      .slice(-3)
      .map((txt, idx) => {
        const num = prevChapters.length - (prevChapters.slice(-3).length - idx) + 1;
        return `Kapitel ${num}: ${shorten(txt, 320)}`;
      })
      .join("\n\n");

    const userLines = [];

    userLines.push(`Barnets idé / prompt (senaste): "${promptRaw}"`);
    userLines.push("");
    userLines.push(`Hjälte / huvudperson: ${heroName}`);
    userLines.push(`Åldersband: ${ageKey} år`);
    userLines.push(`Längdspreset: ${lengthPreset}`);
    userLines.push(`Storyläge: ${storyMode}`);

    if (storyMode === "chapter_book") {
      userLines.push(
        `Detta är kapitel ${chapterIndex} i en kapitelbok (totalt ungefär ${totalChapters} kapitel).`
      );
      userLines.push("");
      userLines.push(
        `Fortsätt samma berättelse som tidigare kapitel. DU FÅR INTE starta en ny saga, nytt äventyr eller en helt ny magisk plats om det inte tydligt redan finns i sammanfattningen eller historiken.`
      );
      userLines.push(
        `Fortsätt direkt efter sista meningen i föregående kapitel. Håll kvar samma huvudproblem, samma hjältar och samma ton.`
      );
      userLines.push("");

      if (previousSummary) {
        userLines.push(
          `Sammanfattning av berättelsen hittills: ${shorten(
            previousSummary,
            420
          )}`
        );
      } else {
        userLines.push(
          `Sammanfattning av berättelsen hittills saknas. Anta att detta är början på boken.`
        );
      }

      if (compactHistory) {
        userLines.push("");
        userLines.push(
          `Några viktiga saker som redan hänt i boken:\n${compactHistory}`
        );
      }
    }

    userLines.push("");
    userLines.push(`Kapitelroll just nu: ${chapterRole}.`);

    if (chapterRole === "chapter_1") {
      userLines.push(
        `Kapitel 1: Börja i vardagen (plats, tid, enkel aktivitet). Låt barnets idé gradvis växa fram. Sätt tonen och visa vem hjälten är. Avsluta gärna med en mild föraning om äventyret, men ingen hård cliffhanger.`
      );
    } else if (chapterRole === "chapter_middle") {
      userLines.push(
        `Mittenkapitel: Fortsätt samma huvudmål. Visa ett tydligt delmål eller hinder på vägen. Du får ibland avsluta med en mild cliffhanger, men inte varje gång. Kapitel ska kännas som fortsättning, inte ny start.`
      );
    } else if (chapterRole === "chapter_final") {
      userLines.push(
        `Slutkapitel: Knyt ihop de viktigaste trådarna. Lös huvudkonflikten tydligt och barnvänligt. Introducera inte stora nya karaktärer eller helt nya magiska objekt i sista stund. Avsluta lugnt, varmt och hoppfullt – utan att skriva moralen rakt ut.`
      );
    } else if (chapterRole === "single_story") {
      userLines.push(
        `Detta är en fristående saga (single_story). Du ska skriva hela berättelsen från början till slut i ett flöde.`
      );
    }

    userLines.push("");
    userLines.push(lengthInstruction);
    userLines.push("");
    userLines.push(
      "VIKTIGT: Skriv endast själva berättelsetexten i löpande text. Inga rubriker, inga listor, inga 'Lärdomar:' och inga förklaringar till varför du skrev som du gjorde."
    );

    const userPrompt = userLines.join("\n");

    // ------------------------------------------------------
    // OpenAI-anrop
    // ------------------------------------------------------

    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    const payload = {
      model,
      temperature: 0.6,
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
  if (s.includes("13") && s.includes("14")) return "13-14";
  if (s.includes("15")) return "15";
  return "7-8";
}

function getLengthInstructionAndTokens(ageKey, lengthPreset) {
  const lp = String(lengthPreset || "").toLowerCase();

  const base = (() => {
    switch (ageKey) {
      case "7-8":
        return {
          baseInstr:
            "Skriv på ett enkelt, tydligt och tryggt sätt som passar 7–8 år. Korta meningar, tydliga känslor, enkel handling, få karaktärer.",
          baseTokens: 900
        };
      case "9-10":
        return {
          baseInstr:
            "Skriv på ett lite mer utvecklat sätt för 9–10 år. Mer detaljer, mer dialog och lite mer spänning, men fortfarande tydligt och tryggt.",
          baseTokens: 1400
        };
      case "11-12":
        return {
          baseInstr:
            "Skriv med mer djup och tempo som passar 11–12 år. Mer känslor, mer detaljerade scener och gärna lite humor.",
          baseTokens: 2000
        };
      case "13-14":
        return {
          baseInstr:
            "Skriv för 13–14 år. Mogen men trygg ton, lite mer komplex handling, men fortfarande barnvänligt och utan grafiskt våld eller sex.",
          baseTokens: 2300
        };
      case "15":
        return {
          baseInstr:
            "Skriv för 15 år. Mogen, men fortfarande tydligt barn- och ungdomsvänligt, utan grafiskt våld eller sex.",
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
  return `
Du är BN-Kids berättelsemotor. Din uppgift är att skriva barnanpassade sagor och kapitelböcker på svenska.

### FOKUS & GENRE
- Följ alltid barnets prompt och tema noggrant.
- Byt aldrig genre eller huvudtema på egen hand.
- Om barnet nämner ett yrke, en sport, ett djur eller ett viktigt objekt (t.ex. en magisk hiss, drakarnas land) ska det vara centralt tills konflikten är löst.
- Skapa inte nya magiska dörrar, nycklar, kistor eller kartor om barnet inte specifikt bett om det.

### ÅLDERSBAND (${ageKey})
Anpassa språk, tempo och komplexitet efter åldern:
- 7–8: enkla meningar, tydliga känslor, få karaktärer, inga subplots.
- 9–10: mer detaljer, lite mer spänning, max en enkel sidotråd.
- 11–12: mer djup, mer dialog, mer avancerade känslor, fortfarande tryggt.
- 13–14 och uppåt: något mognare, men fortfarande barn- och ungdomsvänligt och utan grafiskt våld/sex.

### BN-FLOW (stil)
- Börja inte direkt med barnets prompt, utan i vardagen: plats, tid, enkel aktivitet, stämning.
- Ge 3–8 meningar startscen innan magi/äventyr eller huvudproblemet dyker upp.
- Variera miljöer och objekt. Undvik att upprepa samma mönster i varje saga som:
  - "Det var en solig morgon..." i varje början.
  - Alltid ekar, skattkartor, kistor eller speglar som portal.
  - Alltid samma formulering om att "solen värmde ansiktet".
- Använd dialog naturligt, men inte i varje mening. Blanda korta och längre meningar.

### DJUR & BETEENDEN
- Djurs beteenden ska kännas naturliga:
  - Hästar kan gnägga, puffa med mulen, buffa försiktigt, nosa – undvik att de slickar händer hela tiden.
  - Hundar kan slicka, hoppa, vifta på svansen.
  - Magiska djur kan vara mer lekfulla, men håll dem ändå logiska och trygga.
- Undvik att alla djur beter sig exakt likadant i varje saga.

### MORAL & TON
- Visa känslor och värden genom handling, val och dialog – inte genom predikande meningar.
- Undvik fraser som: "det viktiga är att tro på sig själv", "du måste vara modig", "det viktigaste är vänskap".
- Avslut får gärna vara varma och hoppfulla, men moralen ska kännas, inte skrivas ut.

### KAPITELBOKSLÄGE
När du skriver en kapitelbok:
- Kapitel 1: introducera vardagen, huvudpersonen, miljön och första fröet till huvudproblemet.
- Mittenkapitel: fortsätt samma huvudmål, visa hinder och framsteg. Ibland (men inte alltid) kan du avsluta med en mild cliffhanger.
- Slutkapitel: knyt ihop de viktigaste trådarna, lös huvudkonflikten tydligt och tryggt. Introducera inte helt nya stora karaktärer eller magiska föremål på sista sidan.

### KONTINUITET
- Karaktärer får inte byta namn, kön eller personlighet utan förklaring.
- Viktiga föremål (t.ex. draken, hissen, boken) ska användas konsekvent.
- Du ska fortsätta exakt samma berättelse från tidigare kapitel, inte starta om berättelsen.

### UTDATA
- Skriv endast berättelsetexten.
- Inga rubriker som "Kapitel 1" om inte användaren tydligt vill det.
- Inga punktlistor, inga "Lärdomar:", inga meta-kommentarer om hur du skrev.
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
