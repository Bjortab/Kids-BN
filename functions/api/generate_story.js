// BN Kids — generate_story (GC v1.1 minimal, strictly backwards-compatible)
// Frontend skickar: { ageRange: "1-2|3-4|...|11-12", heroName?: string, prompt: string }
// Returnerar: { story: string }  (exakt vad app.js redan förväntar sig)

export async function onRequestOptions(context) {
  const { env } = context;
  return new Response(null, { 
    status: 204, 
    headers: cors(env?.BN_ALLOWED_ORIGIN || "*") 
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = env?.BN_ALLOWED_ORIGIN || "*";

  // --- Läs input exakt som frontend skickar ---
  let body = {};
  try { body = await request.json(); } catch {}
  const rawAgeRange = (body?.ageRange || "").toString().trim();
  const ageRange = normalizeAge(rawAgeRange);
  const heroName = (body?.heroName || "").toString().trim();
  const userPrompt = (body?.prompt || "").toString().trim();

  if (!ageRange || !userPrompt) {
    return json({ story: "" }, 200, origin); // håll respons-formatet stabilt
  }

  // --- Välj modell (behåll OpenRouter som tidigare) ---
  const OPENROUTER_API_KEY = env?.OPENROUTER_API_KEY || "";
  const MODEL = env?.OPENROUTER_MODEL || "openai/gpt-4o-mini";

  // --- Ton & längd per ålder (utan moralpredikan, fokus på handling) ---
  const { tone, words, maxTokens, temperature } = ageConfig(ageRange);

  // Systemprompt
  const system = [
    "Du skriver engagerande barnberättelser på svenska.",
    "Undvik moraliska pekpinnar och 'lärdom'-slut.",
    "Fokusera på handling, miljö, spänning och konkreta scener.",
    `Målgrupp: ${ageRange}. Ton: ${tone}. Längd: cirka ${words} ord.`,
    "Skriv en sammanhängande saga i löpande text utan rubriker som 'Lärdom'."
  ].join(" ");

  const heroLine = heroName ? `Hjältens namn: ${heroName}.` : "";
  const user = [
    `Sagognista: ${userPrompt}`,
    heroLine,
    "Skriv med naturlig svenska och tempo som passar målgruppen.",
    "Ha en tydlig början, en driven mitt med händelser och en kraftfull slutbild (ingen pekpinne)."
  ].filter(Boolean).join("\n");

  try {
    const aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature,
        top_p: 0.95,
        max_tokens: maxTokens
      })
    });

    if (!aiRes.ok) return json({ story: "" }, 200, origin);

    const data = await aiRes.json().catch(() => ({}));
    const story =
      data?.choices?.[0]?.message?.content?.trim() ||
      data?.choices?.[0]?.message?.content?.[0]?.text?.trim() ||
      "";

    return json({ story: story || "" }, 200, origin);

  } catch {
    return json({ story: "" }, 200, origin);
  }
}

// ----- Helpers -----

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}

function normalizeAge(value) {
  // Remove "år" suffix, replace long dash with hyphen, trim whitespace
  return value
    .replace(/\s*år\s*$/i, "")  // Remove "år" at the end
    .replace(/–/g, "-")          // Replace long dash with hyphen
    .trim();
}

function json(obj, status = 200, origin = "*") {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 
      "Content-Type": "application/json; charset=utf-8", 
      "Cache-Control": "no-store",
      ...cors(origin)
    }
  });
}

function ageConfig(age) {
  switch (age) {
    case "1-2":  return { tone: "rytmisk, trygg, upprepningar, ljudord",      words: 90,   maxTokens: 400,  temperature: 0.6 };
    case "3-4":  return { tone: "lekfull, humor, liten konflikt",             words: 180,  maxTokens: 600,  temperature: 0.7 };
    case "5-6":  return { tone: "äventyrlig, varm, mer handling",             words: 320,  maxTokens: 900,  temperature: 0.8 };
    case "7-8":  return { tone: "målande, spännande, tydliga scener",         words: 550,  maxTokens: 1400, temperature: 0.9 };
    case "9-10": return { tone: "dramatisk, dialog, twist, action",           words: 900,  maxTokens: 2000, temperature: 0.95 };
    case "11-12":return { tone: "episk känsla, mystik, filmisk, starkt slut", words: 1200, maxTokens: 2600, temperature: 0.95 };
    default:
      console.warn(`[generate_story] Unknown age range: "${age}". Using default config.`);
      return { tone: "äventyrlig och målande", words: 500, maxTokens: 1600, temperature: 0.9 };
  }
}
