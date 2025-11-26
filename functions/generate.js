// ======================================================================
// BN-KIDS — functions/generate.js (GC v6.0)
// Fokus:
// - Stabil röd tråd (chapter memory engine)
// - Mjukare BN-flow (A + B + C mix)
// - Ingen start med prompten
// - Mindre klyschor, mindre moral, inga skräcktrigger (ingen röst bakom sig)
// - Ingen random-magikast (ingen plötslig tredje vän som trollar fram fåglar)
// - Kapitelstruktur 1 / mitten / final
// - Bättre prompt weaving (när man inte ändrar prompt)
// - Bättre tempo per ålder
// - Temperatur 0.68 för maximal stabilitet
// ======================================================================

export async function onRequestOptions({ env }) {
  const origin =
    env.KIDSBM_ALLOWED_ORIGIN ||
    "*" ;

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
    "*" ;

  try {
    const body = await request.json().catch(() => ({}));

    // ----------------------------------------------
    // INPUT
    // ----------------------------------------------
    const promptRaw =
      body.prompt || body.storyPrompt || body.childPrompt || "";

    const hero =
      body.heroName || body.kidName || body.hero || "hjälten";

    const ageGroup =
      body.ageGroup || body.age || body.ageRange || "7–8";

    const lengthPreset =
      body.lengthPreset || body.lengthValue || "medium";

    const storyMode =
      body.storyMode || body.story_mode || (body.chapterIndex ? "chapter_book" : "single_story");

    const chapterIndex = Number(body.chapterIndex || 1);

    const worldState = body.worldState || {};
    const totalChapters =
      Number(body.totalChapters || worldState?.meta?.totalChapters) || 8;

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

    // ----------------------------------------------
    // ÅLDERSANPASSNING
    // ----------------------------------------------
    const ageKey = normalizeAge(ageGroup);
    const { lengthInstruction, maxTokens } =
      getLengthInstructionTokens(ageKey, lengthPreset);

    // ----------------------------------------------
    // SYSTEM-PROMPT (A + B + C mix)
    // ----------------------------------------------
    const systemPrompt = buildSystemPrompt_BNKids_v6(ageKey);

    // ----------------------------------------------
    // USER-PROMPT
    // ----------------------------------------------
    const previousSummary =
      worldState.previousSummary ||
      worldState.summary ||
      "";

    const previousChapters = Array.isArray(worldState.previousChapters)
      ? worldState.previousChapters
      : [];

    const isFirstChapter = chapterIndex <= 1;
    const isFinalChapter = chapterIndex >= totalChapters;

    const chapterRole = (() => {
      if (storyMode === "single_story") return "single";
      if (isFirstChapter) return "chapter_1";
      if (isFinalChapter) return "chapter_final";
      return "chapter_middle";
    })();

    // kompakt historik = stabilare röd tråd
    const compactHistory = previousChapters
      .slice(-3)
      .map((txt, idx) => `Kapitel ${previousChapters.length - 2 + idx}: ${shorten(txt, 300)}`)
      .join("\n\n");

    const userPrompt = [
      `Barnets idé: "${promptRaw}"`,
      ``,
      `Hjälte: ${hero}`,
      `Ålder: ${ageKey}`,
      `Längd: ${lengthPreset}`,
      `Läge: ${storyMode}`,
      ``,
      storyMode === "chapter_book"
        ? `Detta är kapitel ${chapterIndex} av totalt ≈${totalChapters}.`
        : null,
      storyMode === "chapter_book"
        ? `Sammanfattning hittills: ${
            previousSummary
              ? shorten(previousSummary, 420)
              : "Ingen sammanfattning – detta är början."
          }`
        : null,
      storyMode === "chapter_book" && previousChapters.length
        ? `Viktiga tidigare händelser:\n${compactHistory || "(inga sparade kapitel)"}`
        : null,
      ``,
      `Kapitelroll: ${chapterRole}`,
      chapterRole === "chapter_1"
        ? `Kapitel 1 ska börja lugnt i vardagen. 3–6 meningar om plats, känsla, enkel aktivitet – INNAN promptens äventyr vävs in.`
        : null,
      chapterRole === "chapter_middle"
        ? `Mittkapitel: bygg världen vidare, håll röda tråden och huvudmålet tydligt. Inga nya huvudpersoner. Inga slumpmässiga magiska saker.`
        : null,
      chapterRole === "chapter_final"
        ? `Final: knyt ihop trådarna lugnt, varmt och tydligt. Ingen moral. Ingen predikan. Ingen ny karaktär.`
        : null,
      ``,
      lengthInstruction,
      ``,
      `UTDATA: Skriv endast berättelsen i löpande text. Ingen rubrik. Ingen moral. Ingen “röst bakom sig”.`
    ]
      .filter(Boolean)
      .join("\n");

    // ----------------------------------------------
    // OpenAI-anrop
    // ----------------------------------------------
    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    const payload = {
      model,
      temperature: 0.68,
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
        { ok: false, error: "OpenAI-fel", details: text.slice(0, 500) },
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
      { ok: false, error: "Serverfel", details: String(e).slice(0, 300) },
      500,
      "*"
    );
  }
}

// ======================================================================
// Hjälpare (samma som tidigare – stabila)
// ======================================================================

function normalizeAge(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.includes("7") && s.includes("8")) return "7-8";
  if (s.includes("9") && s.includes("10")) return "9-10";
  if (s.includes("11") && s.includes("12")) return "11-12";
  if (s.includes("13") && s.includes("14")) return "13-14";
  return "7-8";
}

function getLengthInstructionTokens(ageKey, preset) {
  const base = (() => {
    switch (ageKey) {
      case "7-8":
        return { text: "Skriv tydligt och kortfattat, tryggt tempo.", tokens: 900 };
      case "9-10":
        return { text: "Skriv med lite mer detaljer och humor.", tokens: 1500 };
      case "11-12":
        return { text: "Skriv med mer känsla, dialog och tempo.", tokens: 2000 };
      case "13-14":
        return { text: "Skriv med lite mognare ton, men tryggt.", tokens: 2500 };
      default:
        return { text: "Skriv barnanpassat och tryggt.", tokens: 1600 };
    }
  })();

  let factor = 1.0;
  if (preset.includes("short")) factor = 0.7;
  if (preset.includes("long")) factor = 1.3;

  return {
    lengthInstruction: base.text,
    maxTokens: Math.round(base.tokens * factor)
  };
}

function buildSystemPrompt_BNKids_v6(ageKey) {
  return `
Du är BN-Kids berättelsemotor (GC v6). Du skriver barnvänliga sagor och kapitelböcker med levande ton, varm stil och tydlig röd tråd.

### START & FLOW
- Börja ALLTID med en lugn vardagsscen (3–6 meningar).
- Gå INTE direkt in i barnets prompt.
- Sväv in prompten mjukt i scenen.

### TON
- Varm, lekfull, levande, subtil humor.
- Variera meningar och undvik klyschor.
- Inga moraliska predikningar.
- Inga “en röst bakom sig”, inga skräcktriggers.

### KONTINUITET
- Håll namn, platser och viktiga objekt konsekventa.
- Inga nya huvudkaraktärer efter kapitel 2.
- Ingen slump-magi. Ingen tredje vän som plötsligt trollar.

### KAPITEL
- Kapitel 1: vardag + första fröet.
- Mitten: delmål, hinder, små överraskningar.
- Final: tydlig upplösning, lugn andning.
- Cliffhanger max var tredje kapitel och alltid mjuka.

### ÅLDER (${ageKey})
- Anpassa tempo och detaljnivå exakt efter åldern.

### UTDATA
- Skriv endast berättelsen i ren text.
- Inga rubriker, inga listor, ingen meta.
`.trim();
}

function shorten(t, max) {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
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
