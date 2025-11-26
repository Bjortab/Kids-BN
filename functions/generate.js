// ======================================================================
// BN-KIDS — GENERATE (GC v6.2)
// ----------------------------------------------------------------------
// TOTAL ERSÄTTARE för generate.js
//
// Fokuserar på:
// - HÅRD kapitel-låsning (stoppar ALLA omstarter)
// - BN-Flow (mjuk vardagsstart, varm ton, magi, variation)
// - D-mix: kapitelstart lugn → äventyr → varm finish
// - KONSTANT röd tråd
// - Samma karaktärer, samma relationer
// - Inga nya karaktärer utan att barnet ändrar prompten
// - Fokus på barnets idé, inte modellens fantasi
//
// Denna version är 100% framtagen för att stoppa problemet där AI:n
// "börjar om" trots chapterIndex > 1 och oförändrad prompt.
//
// ======================================================================

export async function onRequestOptions({ env }) {
  const origin =
    env.KIDSBM_ALLOWED_ORIGIN ||
    env.KIDSBM_ALLOWED_ORIGIN_DEV ||
    env.KIDSBM_ALLOWED_ORIGIN_LOCAL ||
    "*";

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

export async function onRequestPost({ request, env }) {
  const origin =
    env.KIDSBM_ALLOWED_ORIGIN ||
    env.KIDSBM_ALLOWED_ORIGIN_DEV ||
    env.KIDSBM_ALLOWED_ORIGIN_LOCAL ||
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
      "7–8";

    const lengthPreset =
      body.lengthPreset ||
      body.length ||
      body.lengthValue ||
      "medium";

    const worldState = body.worldState || {};
    const chapterIndex = Number(body.chapterIndex || 1);
    const totalChapters =
      Number(body.totalChapters || worldState?.meta?.totalChapters) || 9;

    if (!promptRaw) {
      return json({ ok: false, error: "Barnets prompt saknas." }, 400, origin);
    }

    if (!env.OPENAI_API_KEY) {
      return json(
        { ok: false, error: "OPENAI_API_KEY saknas i worker env." },
        500,
        origin
      );
    }

    // ====================================================================
    // FORMATTERA KONTEXT
    // ====================================================================

    const ageKey = normalizeAge(ageGroupRaw);
    const { lengthInstruction, maxTokens } =
      getLengthInstructionAndTokens(ageKey, lengthPreset);

    const previousSummary =
      worldState.previousSummary ||
      worldState.summary ||
      "";

    const previousChapters = Array.isArray(worldState.previousChapters)
      ? worldState.previousChapters
      : [];

    const lastChapterText =
      previousChapters.length > 0
        ? previousChapters[previousChapters.length - 1]
        : "";

    const lastChapterEnding = extractEnding(lastChapterText, 3);

    const isFirstChapter = chapterIndex <= 1;
    const isFinalChapter = chapterIndex >= totalChapters - 1;

    // --------------------------------------------------------------------
    // HÅRD KAPITELLÅSNING (KÄRNAN I V6.2)
    // --------------------------------------------------------------------
    const HARD_CONTINUATION_LOCK = `
Du får ABSOLUT INTE börja om sagan.
Du får INTE starta en ny morgon, ny värld, ny plats eller ny startscen.
Du måste FORTSÄTTA EXAKT där föregående kapitel slutade:

"${lastChapterEnding}"

Ingen ny huvudperson. Ingen omvänd roll.
${heroName} är fortfarande samma person som tidigare kapitel beskriver.
Endast barns uppdaterade prompt får introducera helt nya karaktärer.
`;

    // --------------------------------------------------------------------
    // SYSTEMPROMPT (BLANDNING A+B+C = Option D)
    // --------------------------------------------------------------------

    const systemPrompt = `
Du är BN-Kids berättelsemotor (GC v6.2).
Du skriver magiska, varma, levande kapitelböcker för barn.

### TON & STIL
- Starta kapitlet med mjuk vardaglig känsla (4–6 meningar) **endast i kapitel 1**.
- I kapitel 2+ ska du INTE börja om någonting. Du fortsätter direkt.
- Skriv i levande bilder, naturlig dialog, konkret handling.
- Inga moralkakor. Visa känslor genom handling.
- Variation: använd olika träd, dofter, ljud, miljöer — inte ekar varje gång.

### FORTSÄTTNING & RÖD TRÅD
${isFirstChapter ? "" : HARD_CONTINUATION_LOCK}

- Håll kvar barnets idé genom hela boken.
- ${heroName} får inte byta personlighet eller relation.
- Ingen slumpmässig magi. Magi ska kännas etablerad i boken.
- Introducera ALDRIG en ny huvudfiende eller stort nytt problem sent.

### KAPITELROLL
${chapterIndex === 1
        ? "Kapitel 1: Introducera vardagen, visa första fröet till äventyret."
        : isFinalChapter
        ? "Avslutningskapitel: knyt ihop trådar, lös problemet, värm hjärtat."
        : "Mittenkapitel: ett hinder, ett steg framåt, mjuk cliffhanger är okej."}

### ÅLDER (${ageKey} år)
Anpassa språk, detaljer och tempo efter åldern.

### UTDATA
- Endast berättelsetext i löpande prosa.
- Inga rubriker, inga listor.
- Ingen intern förklaring, ingen moraltext.
`.trim();

    // --------------------------------------------------------------------
    // USERPROMPT
    // --------------------------------------------------------------------

    const compactHistory =
      previousChapters
        .slice(-3)
        .map((txt, i) => `Kapitel ${previousChapters.length - 2 + i}: ${shorten(txt, 260)}`)
        .join("\n\n");

    const userPrompt = [
      `Barnets idé: "${promptRaw}"`,
      ``,
      previousSummary
        ? `Sammanfattning hittills: ${shorten(previousSummary, 360)}`
        : "Ingen sammanfattning ännu.",
      previousChapters.length
        ? `Senaste händelser:\n${compactHistory}`
        : "",
      ``,
      `Kapitelindex: ${chapterIndex}/${totalChapters}`,
      `Hjälte: ${heroName}`,
      ``,
      `Fortsätt nu historien utan att börja om.`,
      ``,
      lengthInstruction
    ]
      .filter(Boolean)
      .join("\n");

    // --------------------------------------------------------------------
    // OPENAI ANROP
    // --------------------------------------------------------------------

    const payload = {
      model: env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.7, // viktig tweak för stabilitet
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
      const t = await res.text().catch(() => "");
      return json(
        { ok: false, error: "OpenAI-fel", details: t.slice(0, 400) },
        502,
        origin
      );
    }

    const data = await res.json();
    const story =
      data.choices?.[0]?.message?.content?.trim() || "";

    return json({ ok: true, story }, 200, origin);
  } catch (err) {
    return json(
      { ok: false, error: "Serverfel", details: String(err).slice(0, 400) },
      500,
      "*"
    );
  }
}

// ======================================================================
// HJÄLPFUNKTIONER
// ======================================================================

function normalizeAge(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.includes("7")) return "7-8";
  if (s.includes("9")) return "9-10";
  if (s.includes("11")) return "11-12";
  if (s.includes("13")) return "13-14";
  return "9-10";
}

function extractEnding(text, sentences = 2) {
  if (!text) return "";
  const parts = text
    .replace(/\n+/g, " ")
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.slice(-sentences).join(". ") + ".";
}

function shorten(txt, maxLen) {
  const s = String(txt || "").replace(/\s+/g, " ").trim();
  return s.length <= maxLen ? s : s.slice(0, maxLen) + "…";
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
