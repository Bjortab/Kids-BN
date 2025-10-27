// BN Kids — generate_story (GC v1.1-dramatic, backwards-compatible)
// Kompatibel med frontend som skickar: ageRange, heroName, prompt
// (accepterar även age, hero). Returnerar { ok:true, story, meta }.

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json().catch(() => ({}));

    // ✅ Bakåtkompatibel insamling av fält
    const ageInput = (body.ageRange || body.age || "").toString().trim(); // "1-2", "3-4", ...
    const prompt = (body.prompt || "").toString().trim();
    const hero = (body.heroName || body.hero || "").toString().trim();

    if (!ageInput) return j({ ok:false, error: "Missing 'ageRange'." }, 400);
    if (!prompt)   return j({ ok:false, error: "Missing 'prompt'." }, 400);

    const apiKey = (env && env.OPENROUTER_API_KEY) || "";
    if (!apiKey) return j({ ok:false, error: "Server saknar OPENROUTER_API_KEY." }, 500);

    // Modell (behåll GC-beteende: använd env.MODEL_CLAUDE om den finns, annars gpt-4o-mini via OpenRouter)
    const model =
      (env && typeof env.MODEL_CLAUDE === "string" && env.MODEL_CLAUDE.trim()) ||
      "openai/gpt-4o-mini";

    // Ton & längd per ålder
    const cfg = getAgeControls(ageInput);

    // Systemprompt: filmisk svenska, ingen moralpredikan
    const systemPrompt = [
      "Du är en svensk barnboksförfattare som skriver filmiska, levande äventyr.",
      "Skriv på naturlig svenska. Undvik moraliska pekpinnar och 'lärdom'-slut.",
      "Fokusera på miljö, scener, konflikt, handling och spänning. Dialog sparsamt men effektfullt.",
      `Åldersgrupp: ${ageInput}. Ton: ${cfg.tone}.`,
      `Längdmål: ${cfg.lengthHint}.`,
      "Skriv allt som en sammanhängande saga i löpande text (inga rubriker som 'Lärdom').",
    ].join(" ");

    // Användarprompt
    const userPrompt = buildUserPrompt({ prompt, hero, cfg });

    // Anrop via OpenRouter (oförändrad metod)
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: cfg.temperature,
        top_p: 0.95,
        max_tokens: cfg.maxTokens,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return j({ ok:false, error: `OpenRouter ${res.status}: ${text}` }, 502);
    }

    const data = await res.json().catch(() => ({}));
    const story =
      data?.choices?.[0]?.message?.content?.trim() ||
      data?.choices?.[0]?.message?.content?.[0]?.text?.trim() ||
      "";

    if (!story) return j({ ok:false, error: "Ingen berättelse genererades." }, 500);

    const meta = { ageRange: ageInput, model, target: cfg.lengthHint, style: cfg.tone };

    return j({ ok:true, story, meta }, 200);
  } catch (err) {
    return j({ ok:false, error: `Serverfel: ${String(err?.message || err)}` }, 500);
  }
}

// ---------- Hjälpfunktioner ----------

function getAgeControls(age) {
  switch (age) {
    case "1-2":
      return {
        tone: "trygg, rytmisk, upprepningar och ljudord; korta meningar; konkreta bilder",
        lengthHint: "≈70–120 ord (mycket kort)",
        maxTokens: 400,
        temperature: 0.6,
      };
    case "3-4":
      return {
        tone: "lekfull och humoristisk; små äventyr; tydlig början och slut",
        lengthHint: "≈150–250 ord (kort)",
        maxTokens: 600,
        temperature: 0.7,
      };
    case "5-6":
      return {
        tone: "äventyrlig och varm; lite mer handling och fantasi",
        lengthHint: "≈250–400 ord (kort–medel)",
        maxTokens: 900,
        temperature: 0.8,
      };
    case "7-8":
      return {
        tone: "målande, spännande; tydliga scener; liten twist i mitten",
        lengthHint: "≈450–700 ord (medel)",
        maxTokens: 1400,
        temperature: 0.9,
      };
    case "9-10":
      return {
        tone: "dramatik, fantasi, action; flera scener; kreativ lösning",
        lengthHint: "≈800–1000 ord (lång)",
        maxTokens: 2000,
        temperature: 0.95,
      };
    case "11-12":
      return {
        tone: "episk känsla och mystik; dialog; högre intensitet; öppning för fortsättning",
        lengthHint: "≈1100–1300 ord (längst)",
        maxTokens: 2600,
        temperature: 0.95,
      };
    default:
      return {
        tone: "äventyrlig och målande utan moralpredikningar",
        lengthHint: "≈500–800 ord",
        maxTokens: 1600,
        temperature: 0.9,
      };
  }
}

function buildUserPrompt({ prompt, hero, cfg }) {
  const heroLine = hero ? `Hjälte/hjältar: ${hero}.` : "";
  return [
    `Barnets idé: ${prompt}`,
    heroLine,
    "Skriv en sammanhängande saga i löpande text.",
    "Fokusera på konkreta detaljer, sinnen och rörelse som driver handlingen.",
    "Inga moraliska lärdomar i slutet; låt slutet vara kraftfullt och gärna med en antydan till nästa äventyr.",
    `Tonalitet: ${cfg.tone}`,
    `Längd: ${cfg.lengthHint}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
