// functions/api/tts.js
export async function onRequestPost(context) {
  try {
    const { text } = await context.request.json();

    if (!text) {
      return new Response(JSON.stringify({ error: 'Ingen text skickades till TTS.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // === Enkel teststub ===
    // Just nu returnerar vi bara texten så du kan se att allt funkar.
    // Byt ut detta mot riktig TTS senare.
    const fakeAudio = Buffer.from('UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=', 'base64'); // tom WAV
    return new Response(fakeAudio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Access-Control-Allow-Origin': '*',
      },
    });

    // === Exempel för riktig OpenAI TTS ===
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
      headers: { 'Content-Type': 'audio/mpeg' },
    });
    */
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Fel i TTS' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
