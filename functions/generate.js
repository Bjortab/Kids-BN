export async function onRequestOptions({ env }) {
  return new Response(null, { status: 204, headers: cors(env.BN_ALLOWED_ORIGIN || "*") });
}

export async function onRequestPost({ request, env }) {
  const allow = env.BN_ALLOWED_ORIGIN || "*";
  try {
    const { prompt, kidName = "Vännen", ageGroup = "3–5 år" } = await request.json();

    if (!prompt || !prompt.trim()) return json({ error: "Skriv vad sagan ska handla om." }, 400, allow);
    if (!env.OPENAI_API_KEY)       return json({ error: "OPENAI_API_KEY saknas." }, 500, allow);

    const sys = [
      "Du är en trygg sagoberättare för barn på svenska.",
      "Skriv en 6–9 min saga (≈700–900 ord).",
      `Åldersanpassa språk och längd för ${ageGroup}.`,
      `Barnets namn är ${kidName}. Inkludera namnet naturligt.`,
      "Snäll ton, utan skräck/våld. Avsluta lugnt och hoppfullt."
    ].join(" ");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.8,
        messages: [{ role: "system", content: sys }, { role: "user", content: `Sagaidé: ${prompt}` }]
      })
    });

    if (!res.ok) {
      const t = await res.text().catch(()=> "");
      return json({ error: "OpenAI fel", details: t }, 502, allow);
    }
    const data = await res.json();
    const story = data?.choices?.[0]?.message?.content?.trim();
    if (!story) return json({ error: "Tomt svar." }, 502, allow);

    const hero = { name: kidName, tagline: "Barnets favorit", createdAt: Date.now() };
    return json({ story, hero }, 200, allow);
  } catch (e) {
    return json({ error: e?.message || "Serverfel" }, 500, allow);
  }
}

function cors(origin){
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
function json(obj, status, origin){
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type":"application/json", ...cors(origin) } });
}
