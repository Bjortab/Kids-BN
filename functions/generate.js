// functions/generate.js
//
// Pages Function: POST /generate
// Tar emot JSON från /api/generate_story och anropar OpenAI med
// en BN-Kids-anpassad systemprompt (kapitelbok, åldersband, mindre moral).
//
// Förväntad body (flexibel):
// {
//   prompt: string,                // barnets prompt
//   heroName?: string,             // hjälten
//   kidName?: string,              // äldre namn-fält
//   ageGroupRaw?: string,          // t.ex. "7-8 år"
//   ageRange?: string,             // fallback
//   storyMode?: "single_story" | "chapter_book",
//   chapterIndex?: number,
//   plannedChapters?: number,      // t.ex. 8, 10, 12
//   previousSummary?: string,      // kort recap
//   previousChapters?: string[],   // historik om vi vill
//   worldState?: { ... }           // BNWorldState om den skickas igenom
// }
//
// OBS: Vi är toleranta – saknas något försöker vi gissa från worldState/meta.
//

export async function onRequestOptions({ env }) {
  const origin = env.KIDSBM_ALLOWED_ORIGIN || "*";
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
  const origin = env.KIDSBM_ALLOWED_ORIGIN || "*";

  try {
    const body = await request.json().catch(() => ({}));

    // -----------------------------
    // 1. Plocka ut grunddata
    // -----------------------------
    const worldState = body.worldState || {};
    const meta = worldState.meta || {};

    const rawPrompt =
      body.prompt ||
      worldState._userPrompt ||
      worldState.last_prompt ||
      meta.originalPrompt ||
      "";

    const heroName =
      (body.heroName ||
        body.kidName ||
        meta.hero ||
        "").trim() || "hjälten";

    const ageGroupRaw =
      (body.ageGroupRaw ||
        body.ageRange ||
        meta.age ||
        meta.ageLabel ||
        "").trim() || "7–8 år";

    const ageKey = normalizeAge(ageGroupRaw);

    const storyMode =
      body.storyMode ||
      worldState.story_mode ||
      "chapter_book";

    const chapterIndex =
      typeof body.chapterIndex === "number"
        ? body.chapterIndex
        : typeof worldState.chapterIndex === "number"
        ? worldState.chapterIndex
        : 1;

    const plannedChapters =
      body.plannedChapters ||
      meta.plannedChapters ||
      10; // default: sikta på 8–12

    const previousSummary =
      body.previousSummary ||
      worldState.previousSummary ||
      "";

    const previousChapters =
      body.previousChapters ||
      worldState.previousChapters ||
      [];

    const { lengthInstruction, maxTokens } =
      getLengthInstructionAndTokens(ageKey);

    if (!rawPrompt) {
      return json(
        { error: "Ingen prompt angiven.", ok: false },
        400,
        origin
      );
    }

    if (!env.OPENAI_API_KEY) {
      return json(
        { error: "OPENAI_API_KEY saknas i miljövariabler.", ok: false },
        500,
        origin
      );
    }

    // -----------------------------
    // 2. Systemprompt (BN-Kids v3)
    // -----------------------------

    const SYSTEM_PROMPT_BN_KIDS = `
Du är BN-Kids berättelsemotor. Din uppgift är att skriva barnanpassade sagor
och kapitelböcker på **svenska**, i en trygg, tydlig och åldersanpassad ton.

### FLE – Focus Lock Engine
1. Följ barnets prompt och tema exakt.
2. Byt inte genre, ton eller huvudtema på eget initiativ.
3. Om barnet nämner ett yrke (t.ex. detektiv) ska kapitlet kretsa kring det yrket.
4. Om barnet nämner ett objekt (t.ex. en diamant, drönare, magisk bok) ska objektet
   vara centralt tills konflikten i boken är löst.
5. Förbjudna inslag om inte barnet tydligt ber om det:
   - ren skräck och hotfulla skuggor
   - demoner, spöken och grafiskt våld
   - hopplöshet eller att världen går under
6. Lätt spänning och konflikter är okej, även för 7–8 år, men håll det barnvänligt.

### Åldersband
Anpassa språk, längd och komplexitet efter ålder:

- junior_7_9: enkelt språk, tydliga meningar, fokus på äventyr och humor.
  Känslor får visas, men förklaras kort och konkret.
- mid_10_12: mer känslor, fler detaljer, lite djupare konflikter. 1 liten subplot är okej.

### Storyläge
- single_story: en komplett saga där huvudkonflikten blir löst i samma text.
- chapter_book: skriv **nästa kapitel** i en längre kapitelbok. Konflikten fortsätter
  tills sista kapitlet. Kapitel ska bygga vidare på tidigare händelser.

### Kapitelroller
- Kapitel 1:
  - Introducera huvudkaraktär/karaktärer, miljö, tonen och huvudmålet.
  - Börja inte alltför bokstavligt på barnets prompt.
    *Exempel*: om prompten är "Björn öppnar den hemliga dörren i källaren",
    börja hellre med stämning, vardag eller vägen ner till källaren innan dörren öppnas.
- Mellankapitel (2 till näst sista):
  - Fördjupa konflikten och låt hjältarna ta små steg framåt.
  - Det får finnas hinder och bakslag, men inga nya huvudproblem.
  - Upprepa inte samma lösning i varje kapitel (inte ny skattkista varje gång osv).
- Sista kapitel:
  - Lös huvudkonflikten tydligt och barnvänligt.
  - Knyt ihop trådar. Introducera inga nya stora problem.
  - Avsluta med positiv eller lugn känsla, inte med moralpredikan.

### Stil och ton
1. Visa känslor genom handlingar och dialog i stället för att skriva ut dem
   som "du är modig", "han är speciell" eller "hon är duktig".
2. Undvik klyschor som upprepas för ofta:
   - hemlig röst bakom ryggen i varje saga
   - glittrande portaler och magiska kistor i varje kapitel
   - att alla bara vill leka när det finns en tydlig konflikt
3. Du får gärna ha en lite mörkare kraft eller ett problem (t.ex. flodhästar som
   förstör saker), men lösningen kan vara att hjälpas åt, lära sig något eller
   ändra beteende – inte att alla plötsligt "bara vill leka snällt".
4. Håll språket naturligt, modernt och lätt att läsa högt.

### Röd tråd och konsekvens
1. Huvudmålet ska vara synligt i varje kapitel.
2. Karaktärer ska inte byta namn, djurart eller personlighet av misstag.
3. Objekt (t.ex. en drönare eller magisk bok) ska ha konsekvent funktion.
4. Om en karaktär introduceras i ett kapitel men försvinner i nästa, ska det finnas
   en logisk förklaring i texten.

### Utdata
- Skriv **enbart berättelsetext**. Inga rubriker, inga sammanfattningar,
  inga listor, inga förklaringar till vuxna.
- Texten ska gå att läsa högt direkt för ett barn i angiven ålder.
`.trim();

    // -----------------------------
    // 3. Bygg user-instruktion
    // -----------------------------

    const recapPart = previousSummary
      ? `Kort sammanfattning av tidigare kapitel: ${previousSummary}\n`
      : previousChapters && previousChapters.length
      ? `Kort info: Det finns redan ${previousChapters.length} kapitel tidigare i boken. Anpassa dig efter detta.\n`
      : "";

    const modeLabel =
      storyMode === "single_story" ? "singelsaga" : "kapitelbok";

    const userInstruction =
      [
        `Barnets prompt: "${rawPrompt}"`,
        `Hjälte/hjältar: ${heroName}`,
        `Åldersgrupp: ${ageGroupRaw} (intern nyckel: ${ageKey})`,
        `Läge: ${modeLabel}`,
        `Aktuellt kapitel: ${chapterIndex} av ungefär ${plannedChapters}.`,
        recapPart || "",
        lengthInstruction,
        "",
        "Skriv nu nästa del enligt reglerna ovan. Börja inte med att bara upprepa prompten ord för ord, utan låt scenen andas lite först.",
        "Skriv bara själva kapitlet, inget annat."
      ].join("\n");

    // -----------------------------
    // 4. Bygg OpenAI-payload
    // -----------------------------

    const payload = {
      model: env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.8,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: SYSTEM_PROMPT_BN_KIDS },
        { role: "user", content: userInstruction }
      ]
    };

    const res = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return json(
        {
          error: "OpenAI-fel",
          ok: false,
          details: t
        },
        res.status,
        origin
      );
    }

    const data = await res.json();
    const story =
      data.choices?.[0]?.message?.content?.trim() || "";

    return json({ ok: true, story }, 200, origin);
  } catch (e) {
    console.error("[generate] Serverfel:", e);
    return json(
      {
        ok: false,
        error: "Serverfel",
        details: String(e)
      },
      500,
      "*"
    );
  }
}

// ---------------------------------------------------------
// Hjälp-funktioner
// ---------------------------------------------------------

function normalizeAge(raw) {
  if (!raw) return "7-8";
  const s = String(raw).toLowerCase();
  if (s.includes("7-8") || s.includes("7–8")) return "7-8";
  if (s.includes("9-10") || s.includes("9–10")) return "9-10";
  if (s.includes("10-12") || s.includes("10–12") || s.includes("11-12") || s.includes("11–12"))
    return "10-12";
  if (s.includes("13-15") || s.includes("13–15")) return "13-15";
  return "7-8";
}

function getLengthInstructionAndTokens(ageKey) {
  switch (ageKey) {
    case "7-8":
      return {
        lengthInstruction:
          "Längd: Skriv ett kapitel för 7–8 år: enkel handling, tydliga meningar, cirka 400–600 ord.",
        maxTokens: 900
      };
    case "9-10":
      return {
        lengthInstruction:
          "Längd: Skriv ett kapitel för 9–10 år: mer utvecklad handling och beskrivningar, cirka 600–900 ord.",
        maxTokens: 1400
      };
    case "10-12":
      return {
        lengthInstruction:
          "Längd: Skriv ett kapitel för 11–12 år: mer komplex handling och känslor, cirka 900–1200 ord.",
        maxTokens: 2000
      };
    case "13-15":
      return {
        lengthInstruction:
          "Längd: Skriv ett kapitel för 13–15 år: mogenare ton, fler detaljer, cirka 1000–1600 ord.",
        maxTokens: 2500
      };
    default:
      return {
        lengthInstruction:
          "Längd: Anpassa längden efter barnets ålder. Lagom långt kapitel.",
        maxTokens: 1200
      };
  }
}

function json(obj, status = 200, origin = "*") {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin
    }
  });
}
