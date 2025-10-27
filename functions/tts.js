export async function onRequestPost(context) {
  const { request, env } = context;
  const { text, voice = "sv-SE-Wavenet-A" } = await request.json();

  if (!text) {
    return new Response(JSON.stringify({ error: "Ingen text att läsa upp." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const ttsRes = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${env.GOOGLE_TTS_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: "sv-SE", name: voice },
        audioConfig: { audioEncoding: "MP3" },
      }),
    });

    const ttsData = await ttsRes.json();
    return new Response(ttsData.audioContent, {
      headers: { "Content-Type": "audio/mpeg" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
