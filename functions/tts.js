export async function onRequestPost({ request, env }) {
  try {
    const { text } = await request.json();
    const key = env.ELEVENLABS_API_KEY;
    const voiceId = env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": key,
      },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
    });

    const audio = await res.arrayBuffer();
    const base64 = Buffer.from(audio).toString("base64");

    return new Response(JSON.stringify({
      url: `data:audio/mpeg;base64,${base64}`,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
