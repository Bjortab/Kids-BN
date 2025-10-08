export async function onRequestPost({ request, env }) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const apiKey = env.OPENAI_API_KEY;

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    const data = await res.json();
    return new Response(JSON.stringify({ text: data.text }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
