// functions/api/generate_story.js
// Skapar en saga utifrån namn, ålder och prompt. Returnerar { ok, story }

const CORS = (env) => ({
  "Access-Control-Allow-Origin": env?.BN_ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
});

// Åldersinställningar: längd/ton
function getAgeSettings(ageRange) {
  // ageRange ex: "1-2", "3-4", "5-6", "7-8", "9-10", "11-12"
  const map = {
    "1-2": { wordsMin: 50,  wordsMax: 150, tone: "bilderboksstil med rim, ljud och upprepningar, mycket tydligt språk" },
    "3-4": { wordsMin: 120, wordsMax: 250, tone: "enkla handlingar, tydlig början och slut, humor och igenkänning" },
    "5-6": { wordsMin: 200, wordsMax: 400, tone: "lite mer komplex berättelse, ett problem som löses, korta kapitelkänslor" },
    "7-8": { wordsMin: 350, wordsMax: 700, tone: "äventyr och mysterier, humor, kan ha cliffhangers i slutet" },
    "9-10": { wordsMin: 600, wordsMax: 1000, tone: "fantasy eller vänskapstema, moraliska frågor, kapitelbokskänsla" },
    "11-12": { wordsMin: 900, wordsMax: 1500, tone: "djupare teman och karaktärsutveckling, fortfarande högläsningsvänlig" }
  };
  return map[ageRange] || map["3-4"];
}

export async function onRequestOptions({ env }) {
  return new Response(null, { status: 204, headers: CORS(env) });
}

export async function onRequestPost({ request, env }) {
  try {
    const { name, ageRange, prompt, heroName } = await request.json();

    if (!env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "OPENAI_API_KEY saknas" }), {
        status: 500, headers: { "Content-Type": "application/json", ...CORS(env) }
      });
    }
    if (!name || !ageRange || !(prompt && prompt.trim())) {
      return new Response(JSON.stringify({ ok: false, error: "name, ageRange och prompt krävs" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS(env) }
      });
    }

    const cfg = getAgeSettings(ageRange);
    const sys = [
      `Du är en barnboksförfattare på svenska.`,
      `Skriv en saga för åldern ${ageRange} år med ${cfg.tone}.`,
      `Måla upp vänliga, trygga miljöer. Absolut inga våldsamma, skrämmande eller vuxna teman.`,
      `Anpassa längden till cirka ${cfg.wordsMin}–${cfg.wordsMax} ord.`,
      `Barnets namn är ${name}.`,
      heroName ? `Hjälten som kan återkomma heter "${heroName}". Använd bara om det passar prompten.` : `Använd inte gamla hjältar om de inte efterfrågas.`,
      `Avsluta sagan med en varm, positiv känsla.`
    ].filter(Boolean).join("\n");

    const user = `Prompt från barn/förälder: ${prompt}`;

    const body = {
      model: env.OPENAI_TEXT_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user }
      ],
      temperature: 0.8
    };

    const ai = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!ai.ok) {
      const err = await ai.text();
      return new Response(JSON.stringify({ ok: false, error: `OpenAI: ${ai.status} ${err}` }), {
        status: 500, headers: { "Content-Type": "application/json", ...CORS(env) }
      });
    }

    const data = await ai.json();
    const story = data.choices?.[0]?.message?.content?.trim() || "";

    return new Response(JSON.stringify({ ok: true, story }), {
      headers: { "Content-Type": "application/json", ...CORS(env) }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS(env) }
    });
  }
}

// Alla andra metoder → 405
export async function onRequest() {
  return new Response("Method Not Allowed", { status: 405 });
}
