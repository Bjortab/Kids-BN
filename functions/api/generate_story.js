export async function onRequestPost(context) {
  const { request, env } = context;
  const { age, hero, prompt } = await request.json();

  const OPENAI_KEY = env.OPENROUTER_API_KEY;

  // Grundläggande kontroll
  if (!prompt || !age) {
    return new Response(JSON.stringify({ error: "Ålder och sagoinput krävs." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 🎨 Stil- och toninstruktioner per åldersgrupp
  const stylePrompts = {
    "1-2": "Skriv en mycket kort, trygg och rytmisk saga med upprepningar, djurläten och enkla meningar. Fokus på ljud, färger och trygghet.",
    "3-4": "Skriv en kort, lekfull och humoristisk saga med små äventyr, igenkänning och värme. Enkel struktur, tydlig början och slut.",
    "5-6": "Skriv en spännande men varm berättelse med upptäckarglädje och humor. Lite mer handling och fantasi men fortfarande trygg ton.",
    "7-8": "Skriv en levande och målande äventyrssaga. Tydliga scener, magi, vänskap och upptäckter. Låt handlingen stå i fokus, inte moral.",
    "9-10": "Skriv en längre och dramatisk saga med tydlig miljöbeskrivning, dialog, spänning och oväntade vändningar. Undvik moralpredikningar.",
    "11-12": "Skriv en lång, filmisk äventyrsberättelse med mystik, kamp och känslor. Låt händelser och karaktärer driva historien, inte lärdomar. Slutet får gärna vara öppet eller antyda fortsättning.",
  };

  // 🎯 Dynamisk längd per ålder
  const wordTargets = {
    "1-2": 150,
    "3-4": 250,
    "5-6": 400,
    "7-8": 600,
    "9-10": 900,
    "11-12": 1200,
  };

  const style = stylePrompts[age] || "Skriv en engagerande saga för barn.";
  const targetWords = wordTargets[age] || 500;
  const heroText = hero ? `Hjälten i sagan heter ${hero}.` : "";

  const fullPrompt = `
Du är en barnboksförfattare. ${style}
Berättelsen ska vara ungefär ${targetWords} ord lång.
${heroText}
Sagans idé: ${prompt}
`;

  try {
    const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Du skriver engagerande barnberättelser på svenska. Berättelserna ska vara målande, spännande och känslofyllda, utan moralpredikningar. Fokusera på handling och äventyr.",
          },
          { role: "user", content: fullPrompt },
        ],
        temperature: 0.9,
        max_tokens: 2000,
      }),
    });

    const data = await aiResponse.json();

    if (!aiResponse.ok) {
      return new Response(
        JSON.stringify({ error: data.error || "Fel vid AI-svar." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const story = data.choices?.[0]?.message?.content || "Ingen berättelse genererad.";

    return new Response(JSON.stringify({ story }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Serverfel: " + err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
