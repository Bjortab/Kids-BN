// functions/api/tts.js
export async function onRequestPost(context) {
  try {
    const { text } = await context.request.json();

    if (!text) {
      return new Response(
        JSON.stringify({ error: 'Ingen text skickades till TTS.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // === Minimal teststub (fungerar i Cloudflare Workers) ===
    // Vi skapar ett litet tyst WAV-ljud (1 sekund) så vi ser att ljuddelen fungerar.
    const silentWavBase64 =
      "UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
    const binary = Uint8Array.from(atob(silentWavBase64), c => c.charCodeAt(0));

    return new Response(binary, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Access-Control-Allow-Origin": "*"
      }
    });

    // === Exempel (riktig TTS med OpenAI) ===
    /*
    const apiKey = context.env.OPENAI_API_KEY;
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: 'alloy',
        input: text,
      }),
    });

    if (!res.ok) throw new Error(`OpenAI TTS-fel: ${res.status}`);
    const audio = await res.arrayBuffer();

    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Access-Control-Allow-Origin": "*"
      }
    });
    */
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Fel i TTS" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
