export async function onRequestPost({ request, env }) {
  try {
    const { name, age, prompt } = await request.json();
    const apiKey = env.OPENAI_API_KEY;

    const promptFull = `Skapa en vänlig och fantasifull saga för barn (${age}). Huvudpersonens namn är ${name || "barnet"}.
Sagans ämne: ${prompt}.
Använd enkel svenska, max 250 ord.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: promptFull }],
      }),
    });

    const data = await response.json();
    const story = data.choices?.[0]?.message?.content || "Ingen saga kunde skapas just nu.";

    const title = story.split("\n")[0].replace(/\*/g, "").slice(0, 60);

    return new Response(JSON.stringify({ title, story }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
