// functions/api/generate_story.js

/**
 * BN Kids — generate_story API (Cloudflare Pages Functions)
 * - Hanterar CORS (OPTIONS)
 * - Accepterar POST (JSON)
 * - Åldersanpassar längd/ton
 * - Använder OpenAI chat-completions
 */

const mapAgeToSpec = (ageRange) => {
  // Åldersspann -> ordmängd och ton
  const table = {
    "1–2": { min: 60,  max: 150,  tone: "mycket enkel, rytmisk, upprepningar, trygg och varm" },
    "3–4": { min: 120, max: 250,  tone: "enkel, lekfull, tydlig början och slut, humor" },
    "5–6": { min: 180, max: 350,  tone: "lite mer komplex, små problem som löses, fantasi" },
    "7–8": { min: 280, max: 450,  tone: "äventyr, mysterium, humor, enkla cliffhangers" },
    "9–10": { min: 380, max: 650, tone: "fantasy, vänskap, moraliska frågor, tydliga scener" },
    "11–12": { min: 500, max: 900, tone: "djupare teman, karaktärsutveckling, lite längre scener" },
  };
  return table[ageRange] || table["3–4"];
};

const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json; charset=utf-8",
});

export const onRequestOptions = async ({ env }) => {
  const origin = env?.BN_ALLOWED_ORIGIN || "*";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
};

export const onRequestPost = async ({ request, env }) => {
  const origin = env?.BN_ALLOWED_ORIGIN || "*";

  // Säkerställ nödvändiga env
  const OPENAI_API_KEY = env?.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: "Saknar OPENAI_API_KEY i Secrets." }),
      { status: 500, headers: corsHeaders(origin) }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "Ogiltig JSON i body." }),
      { status: 400, headers: corsHeaders(origin) }
    );
  }

  const {
    childName = "",
    ageRange = "3–4",
    prompt = "",
    heroName = "", // valfritt
    locale = "sv-SE",
  } = payload || {};

  if (!prompt || typeof prompt !== "string") {
    return new Response(
      JSON.stringify({ ok: false, error: "Fältet 'prompt' krävs." }),
      { status: 400, headers: corsHeaders(origin) }
    );
  }

  // Åldersspec
  const spec = mapAgeToSpec(ageRange);

  // Hjälte-instruktion (endast om användaren angivit ett namn)
  const heroLine = heroName?.trim()
    ? `Om det passar, inkludera hjälten "${heroName.trim()}" konsekvent.`
    : `Använd inte tidigare hjältar; introducera figurer från prompten endast vid behov.`;

  // Systemprompt (svenska)
  const systemPrompt = `
Du är en sagoberättare på svenska för barn ${ageRange} år.
Skriv en originell saga med ${spec.min}–${spec.max} ord.
Ton: ${spec.tone}.
Språk: enkel svenska, åldersanpassat, undvik våld och skrämmande innehåll.
Avsluta med en varm, positiv känsla. ${heroLine}
Om barnet heter: "${childName}", kan namnet förekomma varsamt (valfritt).
Formatera med en tydlig titel överst (fetstil) följt av korta stycken.
`.trim();

  // Använd GPT (modell kan styras via env, fallback till gpt-4o-mini)
  const model = env?.OPENAI_TEXT_MODEL || "gpt-4o-mini";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.8,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Sagan ska handla om: ${prompt}` },
        ],
      }),
    });

    if (!res.ok) {
      const err = await safeJson(res);
      return new Response(
        JSON.stringify({
          ok: false,
          error: "OpenAI misslyckades",
          status: res.status,
          details: err,
        }),
        { status: 502, headers: corsHeaders(origin) }
      );
    }

    const data = await res.json();
    const storyText =
      data?.choices?.[0]?.message?.content?.trim() ||
      "Kunde inte generera saga just nu.";

    return new Response(
      JSON.stringify({
        ok: true,
        story: storyText,
        meta: {
          ageRange,
          targetWords: [spec.min, spec.max],
          locale,
          model,
        },
      }),
      { status: 200, headers: corsHeaders(origin) }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message || e) }),
      { status: 500, headers: corsHeaders(origin) }
    );
  }
};

// Hjälpare
async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    const t = await res.text().catch(() => "");
    return { text: t || "<no-body>" };
  }
}
