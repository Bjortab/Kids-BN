export async function onRequestPost(ctx) {
  try {
    const env = ctx.env || {};
    const { OPENAI_API_KEY, OPENAI_MODEL = "gpt-4o-mini" } = env;
    if (!OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY saknas" }, 500);

    const body = await ctx.request.json().catch(() => ({}));
    const {
      childName,
      ageRange = "3–4 år",
      heroName,
      idea = "",
      targetWords = [150, 350],
      styleHint = ""
    } = body || {};

    const [minW, maxW] = Array.isArray(targetWords) && targetWords.length === 2 ? targetWords : [150, 350];

    const system = `
Du är en snäll barnboksförfattare. Skriv en saga på svenska för åldern "${ageRange}".
Längd: sikta på ${minW}–${maxW} ord. Stil: ${styleHint}.
Använd barnets namn om det gavs, annars undvik att hitta på eget.
Använd hjälten om ett namn gavs; annars skapa *en neutral hjälte* som passar temat.
Absolut inga referenser till tidigare sagor – varje saga ska vara helt fristående.
Avsluta med en varm, trygg känsla.
`;

    const user = `
Barnets namn: ${childName || "(okänt)"}.
Hjältens namn: ${heroName || "(ingen specificerad)"}.
Sagognista/tema: ${idea}.
Skriv sagan nu.
`;

    const story = await callOpenAI(OPENAI_API_KEY, OPENAI_MODEL, system, user);

    return json({
      story,
      voice_id: null // låt /api/tts välja default om du inte sätter här
    });
  } catch (err) {
    return json({ error: err?.message || String(err) }, 500);
  }
}

async function callOpenAI(key, model, system, user) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      temperature: 0.7
    })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI ${res.status}: ${t}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
