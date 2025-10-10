// functions/api/generate_story.js

const mapAgeToSpec = (ageRange) => {
  const table = {
    "1–2": { min: 60, max: 150, tone: "mycket enkel, rytmisk, upprepningar, trygg och varm" },
    "3–4": { min: 120, max: 250, tone: "enkel, lekfull, tydlig början och slut, humor" },
    "5–6": { min: 180, max: 350, tone: "lite mer komplex, små problem som löses, fantasi" },
    "7–8": { min: 280, max: 450, tone: "äventyr, mysterium, humor, enkla cliffhangers" },
    "9–10": { min: 380, max: 650, tone: "fantasy, vänskap, moraliska frågor, tydliga scener" },
    "11–12": { min: 500, max: 900, tone: "djupare teman, karaktärsutveckling, längre scener" },
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
    return new Response(JSON.stringify({ ok: false, error: "Ogiltig JSON." }), {
      status: 400,
      headers: corsHeaders(origin),
    });
  }

  const { childName = "", ageRange = "3–4", prompt = "", heroName = "" } = payload || {};
  if (!prompt) {
    return new Response(
      JSON.stringify({ ok: false, error: "Fältet 'prompt' krävs." }),
      { status: 400, headers: corsHeaders(origin) }
    );
  }

  const spec = mapAgeToSpec(ageRange);
  const heroLine = heroName?.trim()
    ? `Om det passar, inkludera hjälten "${heroName.trim()}" i sagan.`
    : `Ingen hjälte krävs; skapa figurer efter behov.`;

  const systemPrompt = `
Du är en svensk sagoberättare för barn ${ageRange} år.
Skriv en saga på ${spec.min}–${spec.max} ord.
Ton: ${spec.tone}.
Avsluta med varm, positiv känsla. ${heroLine}
Barnets namn (om angivet): ${childName}.
`.trim();

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
      const errText = await res.text();
      return new Response(
        JSON.stringify({ ok: false, error: "Fel från OpenAI", details: errText }),
        { status: 502, headers: corsHeaders(origin) }
      );
    }

    const data = await res.json();
    const story = data?.choices?.[0]?.message?.content?.trim() || "Kunde inte skapa saga.";

    return new Response(
      JSON.stringify({ ok: true, story }),
      { status: 200, headers: corsHeaders(origin) }
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: corsHeaders(origin),
    });
  }
};
