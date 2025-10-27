export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const age = url.searchParams.get("age") || "";
  const hero = url.searchParams.get("hero") || "";
  const prompt = url.searchParams.get("prompt") || "";

  if (!prompt.trim()) {
    return new Response(JSON.stringify({ error: "Ingen sagotext angiven." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const storyPrompt = `
    Skriv en kort och fantasifull barnberättelse på svenska för ett barn ${age} år gammalt.
    Hjälten heter ${hero || "ett magiskt djur"}.
    Berättelsen ska börja med "Det var en gång" och sluta lyckligt.
    Barnets idé: ${prompt}.
    `;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: storyPrompt }],
        temperature: 0.8,
      }),
    });

    const data = await response.json();
    const story = data.choices?.[0]?.message?.content?.trim() || "Kunde inte skapa berättelse.";

    return new Response(JSON.stringify({ story }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
