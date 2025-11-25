// ===============================================================
// BN-KIDS — functions/generate.js
// VERSION: v5.0 (Golden Copy)
// Fokus:
// - EXTREMT stabil kapitelkedja
// - BN-FLOW (som du älskar): lugn vardagsstart, bra ton, inga moralfloskler
// - Följer prompten, men börjar INTE om sagan
// - Ingen upprepning av regler i texten
// - INGA "en röst bakom sig", INGA ekar/kistor
// ===============================================================

export async function onRequestPost({ request, env }) {
  const origin = "*";

  try {
    const body = await request.json().catch(() => ({}));

    const prompt = body.prompt || "";
    const hero = body.hero || "hjälten";
    const age = body.age || "7–8";
    const storyMode = body.storyMode || "chapter_book";
    const chapterIndex = Number(body.chapterIndex || 1);
    const worldState = body.worldState || {};
    const previousChapters = Array.isArray(worldState.previousChapters)
      ? worldState.previousChapters
      : [];

    // Hur många kapitel?
    const totalChapters =
      Number(body.totalChapters || worldState?.meta?.totalChapters) || 8;

    if (!prompt) {
      return json(
        { ok: false, error: "prompt saknas" },
        400,
        origin
      );
    }

    // Token-budget & längdinstruktion
    const { maxTokens, lengthInstruction } =
      getLength(age, body.lengthPreset || "medium");

    // Kapitel-roll
    const chapterRole = getChapterRole(
      storyMode,
      chapterIndex,
      totalChapters
    );

    // Kompakt historik (bara de sista 3)
    const compactHistory = previousChapters
      .slice(-3)
      .map((txt, i) => shorten(txt, 280))
      .join("\n\n");

    // ----------------------------------------------------------
    // SYSTEMPROMPT
    // ----------------------------------------------------------
    const systemPrompt = buildSystemPrompt(age);

    // ----------------------------------------------------------
    // USER PROMPT
    // ----------------------------------------------------------
    const userPrompt = [
      `Barnets idé: "${prompt}"`,
      "",
      `Hjälte: ${hero}`,
      `Åldersband: ${age}`,
      "",
      storyMode === "chapter_book"
        ? `Detta är kapitel ${chapterIndex} av en kapitelbok på ca ${totalChapters} kapitel.`
        : "Detta är en fristående saga.",
      "",
      previousChapters.length
        ? `Detta har hänt tidigare:\n${compactHistory}`
        : "Boken har precis börjat.",
      "",
      `Kapitelroll: ${chapterRole}`,
      chapterRole === "chapter_1"
        ? "Börja lugnt i vardagen: plats, stämning, aktivitet. Barnets idé ska glida in naturligt efter 4–8 meningar."
        : null,
      chapterRole === "chapter_middle"
        ? "Detta är ett mittenkapitel. Fortsätt samma huvudmål. Visa hinder/framsteg. Ingen ny huvudkonflikt."
        : null,
      chapterRole === "chapter_final"
        ? "Knyt ihop trådarna, lös konflikten tydligt, inga nya karaktärer, inga moraliska predikningar."
        : null,
      "",
      lengthInstruction,
      "",
      "Svara med endast berättelsetexten."
    ]
      .filter(Boolean)
      .join("\n");

    // ----------------------------------------------------------
    // CALL OPENAI
    // ----------------------------------------------------------
    const payload = {
      model: env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.65, // stabilare och konsekventare
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
      return json(
        { ok: false, error: "OpenAI serverfel", details: await res.text() },
        502,
        origin
      );
    }

    const data = await res.json();
    const story = data.choices?.[0]?.message?.content?.trim() || "";

    return json({ ok: true, story }, 200, origin);
  } catch (err) {
    return json(
      { ok: false, error: "Internt fel", details: String(err) },
      500,
      origin
    );
  }
}

// ===============================================================
// HELPERS
// ===============================================================

function buildSystemPrompt(ageKey) {
  return `
Du är BN-Kids berättelsemotor.

FOKUS:
- Följ barnets prompt noggrant.
- INGA "röster bakom sig".
- INGA skattkartor/kistor om barnet inte ber om det.
- Variera miljöer och objekt.
- INGA moralpredikningar. Visa känslor i handling.

BN-FLOW (viktigt!):
- Börja ALDRIG direkt med barnets idé.
- Inled alltid med vardag: plats, aktivitet, stämning.
- Använd 4–8 meningar innan huvudidén glider in naturligt.
- Skriv mjukt, varmt, fantasifullt.

ÅLDERSBAND:
- 7–8: kort, tydligt, tryggt, få karaktärer.
- 9–10: mer dialog, mer detaljer.
- 11–12: djupare känslor, mer tempo.

KAPITELSTRUCTUR:
- Kapitel 1: lugn start + introducera frö till konflikt.
- Mittenkapitel: hinder & framsteg, max 1 sidospår.
- Final: knyt ihop, inga nya konflikter.

Utdatat:
- Endast berättelsen.
`.trim();
}

function getChapterRole(mode, index, max) {
  if (mode !== "chapter_book") return "single_story";
  if (index <= 1) return "chapter_1";
  if (index >= max - 1) return "chapter_final";
  return "chapter_middle";
}

function getLength(age, preset) {
  const base = (() => {
    if (age === "7-8") return 900;
    if (age === "9-10") return 1400;
    if (age === "11-12") return 2000;
    return 1500;
  })();

  let factor = 1.0;
  if (String(preset).toLowerCase().includes("kort")) factor = 0.7;
  if (String(preset).toLowerCase().includes("lång")) factor = 1.3;

  const maxTokens = Math.round(base * factor);

  const lengthInstruction =
    preset === "kort"
      ? "Sagan ska vara kortare än normalt."
      : preset === "lång"
      ? "Sagan får gärna vara längre än normalt."
      : "Lagom längd – inte för kort, inte för lång.";

  return { maxTokens, lengthInstruction };
}

function shorten(txt, max) {
  const t = String(txt || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
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
