// functions/generate.js
// Pages function: POST /api/generate
// Ny GC-version för BN-Kids – styr ton, kapitel-logik och åldersanpassning.
//
// OBS: Detta är den RIKTIGA berättelsemotorn.
// /functions/api/generate_story.js är bara en proxy som skickar hit.

export async function onRequestOptions({ env }) {
  const origin =
    env.KIDSBM_ALLOWED_ORIGIN ||
    env.KIDSBM_ALLOWED_ORIGIN_WWW ||
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

// -------------------------------------------------------
// SYSTEMPROMPT – här bor alla regler
// -------------------------------------------------------

const SYSTEM_PROMPT_BN_KIDS = `
Du är BN-Kids berättelsemotor. Du skriver trygga, tydliga, roliga sagor
och kapitelböcker för barn på svenska.

FOKUS-LÅS (Focus Lock Engine)
1. Följ barnets prompt och huvudtema exakt. Hitta inte på ett nytt tema.
2. Om barnet nämner ett yrke (t.ex. detektiv, fotbollsspelare, rymdutforskare)
   ska varje kapitel kretsa kring det yrket / huvudrollen.
3. Om barnet nämner ett viktigt objekt (t.ex. en magisk bok, skattkista,
   hemlig dörr, drönare) ska objektet vara centralt tills konflikten är löst.
4. Byt aldrig genre av dig själv (t.ex. detektiv -> skräck -> fantasy)
   om barnet inte uttryckligen ber om det.

ÅLDERSBAND
- 7–9 år: enkelt språk, korta meningar, tydlig handling, humor och trygg stämning.
          Inga subplots. Max ett huvudspår.
- 10–12 år: mer känslor, lite mer djup, ev. EN enkel subplot som hänger ihop med huvudmålet.

TON OCH MORAL
1. Alltid barnvänligt. Ingen skräck, inga grafiska detaljer.
2. Visa moral genom handling istället för att skriva ut den.
   Undvik meningar som:
   - "Det viktigaste var att vara modig/snäll."
   - "Han lärde sig att man alltid måste..." etc.
   Låt läsaren förstå genom vad barnen gör, inte genom att du predikar.
3. Ingen vuxen romantik. För äldre barn (10–12) får du ha lätta förtjusningar/crush,
   men håll det oskyldigt och varmt.

NAMN OCH "VÄNNEN"
1. Använd ALDRIG ordet "Vännen" som namn på en karaktär.
2. Om inget hjältenamn skickas från systemet:
   - använd namn som redan finns i barnets prompt,
   - eller skriv i tredje person ("han", "hon", "hen") utan att skapa namnet "Vännen".

STORYLÄGE
- single_story: skriv en komplett saga som löser konflikten i samma text.
- chapter_book: skriv ett kapitel i en längre bok. Konflikten fortsätter
  tills den är löst i de sista kapitlen.

KAPITELLÅGIK (chapter_book)
- Kapitel 1:
  * Börja i vardagen: kort scen om miljö, vardag, person, känsla.
    Exempel: morgon hemma, på väg till skolan, på biblioteket, i omklädningsrummet osv.
  * För sedan in barnets prompt – den magiska dörren, drönaren, hemliga boken –
    efter några meningar. Inte i första raden.
  * Presentera huvudpersonen tydligt + huvudmål.
  * Starta äventyret men spara mycket av potentialen till senare kapitel.

- Kapitel 2–10:
  * Fortsätt där förra kapitlet slutade.
  * Gör högst 1–2 meningar recap ("Kort påminnelse om vad som hänt...")
    och gå sedan vidare till NYA händelser.
  * Upprepa inte första scenen (t.ex. att de hittar dörren, hissen, kistan) som om allt börjar om.
  * Använd sammanfattningen av tidigare kapitel för att hålla tråden:
    samma karaktärer, samma värld, samma problem.
  * Högst EN ny stor händelse per kapitel som driver storyn framåt.

- Sista kapitel:
  * Lös huvudkonflikten tydligt och tryggt.
  * Knyt ihop viktiga trådar.
  * Avsluta med en positiv, lugn känsla – men utan att skriva
    en lång moralpredikan. Visa i stället i scenen.

SPORT- OCH FOTBOLLSTEMAN
- Låt inte varje mening handla om själva sportmomentet.
- Varva träning/match med vardag: vänner, skola, familj, tankar, misstag, komik.
- Resultat är mindre viktigt än känslan och relationerna.

KONTINUITET (Story Consistency Engine – förenklad)
1. Håll karaktärer, djur, föremål och platser konsekventa mellan kapitel.
   En kanin ska inte bli en hund i nästa kapitel, om inte det är en tydlig,
   förklarad magisk förvandling.
2. Använd tidigare händelser och lösningar – glöm dem inte.
3. Om det finns en sammanfattning eller utdrag från tidigare kapitel
   ska du använda det som källa för vad som faktiskt hänt.

SVARFORMAT
- Svara ALLTID endast med själva berättelsetexten, inga rubriker, inga citattecken,
  inga förklaringar, inga listor. Bara kapiteltexten.
`;

// -------------------------------------------------------
// Huvudfunktion: POST /api/generate
// -------------------------------------------------------

export async function onRequestPost({ request, env }) {
  const origin =
    env.KIDSBM_ALLOWED_ORIGIN ||
    env.KIDSBM_ALLOWED_ORIGIN_WWW ||
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

    const promptRaw = (body.prompt || "").trim();
    const heroName = (body.heroName || body.kidName || "").trim();
    const ageGroupRaw = (body.ageGroup || body.ageRange || "").trim();
    const storyMode = (body.storyMode || body.story_mode || "single_story").trim();
    const chapterIndex = Number(body.chapterIndex || body.chapter_index || 1) || 1;

    const previousSummary = (body.previousSummary || body.previous_summary || "").trim();
    const previousChapters = Array.isArray(body.previousChapters)
      ? body.previousChapters
      : [];

    if (!promptRaw) {
      return json(
        { ok: false, error: "Saknar prompt: ange vad sagan ska handla om." },
        400,
        origin
      );
    }

    if (!env.OPENAI_API_KEY) {
      return json(
        { ok: false, error: "OPENAI_API_KEY saknas i miljövariabler." },
        500,
        origin
      );
    }

    const ageKey = normalizeAge(ageGroupRaw);
    const { lengthInstruction, maxTokens } =
      getLengthInstructionAndTokens(ageKey);

    // ---------------------------------------------------
    // Bygg kapitel-instruktion
    // ---------------------------------------------------
    let chapterProfile = "";
    if (storyMode === "chapter_book") {
      if (chapterIndex <= 1) {
        chapterProfile = `
Detta är KAPITEL 1 i en kapitelbok på ungefär 8–12 kapitel.
Börja i vardagen (hemma, skola, biblioteket, på väg till träning).
Först efter några meningar dyker barnets magiska/ovanliga händelse upp.
Presentera huvudpersonen och huvudmålet tydligt. Starta äventyret,
men spara mycket av potentialen till senare kapitel.
        `.trim();
      } else {
        chapterProfile = `
Detta är KAPITEL ${chapterIndex} i en kapitelbok på ungefär 8–12 kapitel.
Gör högst 1–2 meningar recap av vad som hänt hittills, sedan nya händelser.
Upprepa INTE första kapitlets startsituation. Fortsätt där förra kapitlet slutade
och för handlingen ett tydligt steg framåt.
        `.trim();
      }
    } else {
      // single_story
      chapterProfile = `
Detta är en fristående saga (single_story).
Konflikten ska presenteras och lösas i samma berättelse.
      `.trim();
    }

    // Kontext från tidigare kapitel (om finns)
    let contextBlock = "";
    if (previousSummary) {
      contextBlock += `Sammanfattning av tidigare kapitel:\n${previousSummary}\n\n`;
    }
    if (previousChapters && previousChapters.length > 0) {
      const lastChapter =
        String(previousChapters[previousChapters.length - 1] || "").slice(0, 800);
      if (lastChapter) {
        contextBlock += `Utdrag från senaste kapitel:\n${lastChapter}\n\n`;
      }
    }

    // Hjältenamn – men inga påtvingade "Vännen"
    let heroInstruction = "";
    if (heroName) {
      heroInstruction = `Hjältens namn är "${heroName}". Använd namnet naturligt i texten.`;
    } else {
      heroInstruction = `
Inget hjältenamn skickades från systemet. Hitta inte på namnet "Vännen".
Använd i första hand namn som finns i barnets prompt, annars pronomen (han/hon/hen).
      `.trim();
    }

    const userMessage = `
${contextBlock}
Barnets önskan / prompt (vad sagan ska handla om):
"${promptRaw}"

Målgrupp: barn ${ageKey}.

Berättelseläge: ${storyMode}.
Kapitelindex: ${chapterIndex}.

${chapterProfile}

Längdinstruktion:
${lengthInstruction}

${heroInstruction}

Viktigt:
- Svara endast med själva berättelsetexten, inga rubriker eller förklaringar.
- Undvik upprepade "moralkakor". Visa istället genom handling.
    `.trim();

    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    const payload = {
      model,
      temperature: 0.8,
      messages: [
        { role: "system", content: SYSTEM_PROMPT_BN_KIDS },
        { role: "user", content: userMessage }
      ]
    };

    if (maxTokens) {
      payload.max_tokens = maxTokens;
    }

    const apiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!apiRes.ok) {
      const t = await apiRes.text().catch(() => "");
      return json(
        { ok: false, error: "OpenAI-fel", details: t },
        502,
        origin
      );
    }

    const data = await apiRes.json();
    const storyRaw =
      data.choices?.[0]?.message?.content?.trim() || "";

    return json(
      {
        ok: true,
        story: storyRaw
      },
      200,
      origin
    );
  } catch (e) {
    return json(
      { ok: false, error: e?.message || "Serverfel" },
      500,
      (
        env.KIDSBM_ALLOWED_ORIGIN ||
        env.KIDSBM_ALLOWED_ORIGIN_WWW ||
        env.KIDSBM_ALLOWED_ORIGIN_DEV ||
        env.KIDSBM_ALLOWED_ORIGIN_LOCAL ||
        env.KIDSBM_ALLOWED_ORIGIN_PREVIEW ||
        env.KIDSBM_ALLOWED_ORIGIN_PROD ||
        env.KIDSBM_ALLOWED_ORIGIN_KIDS ||
        env.KIDSBM_ALLOWED_ORIGIN_BN ||
        env.KIDSBM_ALLOWED_ORIGIN_KIDSBM ||
        "*"
      )
    );
  }
}

// -------------------------------------------------------
// Hjälpare
// -------------------------------------------------------

function normalizeAge(raw) {
  const s = (raw || "").toLowerCase();
  if (s.includes("7-8") || s.includes("7–8")) return "7–8 år";
  if (s.includes("9-10") || s.includes("9–10")) return "9–10 år";
  if (s.includes("11-12") || s.includes("11–12")) return "11–12 år";
  if (s.includes("13-15") || s.includes("13–15")) return "13–15 år";
  return "7–8 år";
}

function getLengthInstructionAndTokens(ageKey) {
  switch (ageKey) {
    case "7–8 år":
      return {
        lengthInstruction:
          "Skriv en saga för 7–8 år: enkel handling, tydliga karaktärer och cirka 400–600 ord.",
        maxTokens: 900
      };
    case "9–10 år":
      return {
        lengthInstruction:
          "Skriv en saga för 9–10 år: mer handling och beskrivningar, cirka 600–900 ord.",
        maxTokens: 1400
      };
    case "11–12 år":
      return {
        lengthInstruction:
          "Skriv en saga för 11–12 år: längre och mer utvecklad intrig, cirka 900–1200 ord.",
        maxTokens: 2000
      };
    case "13–15 år":
      return {
        lengthInstruction:
          "Skriv en saga för 13–15 år: mogen ton för yngre tonåringar, mer komplex handling, cirka 1000–1600 ord.",
        maxTokens: 2500
      };
    default:
      return {
        lengthInstruction:
          "Skriv en saga anpassad för barn – anpassa längd efter åldern.",
        maxTokens: undefined
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
