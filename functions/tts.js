// /api/tts  —  POST { text }
// Returnerar { ok:true, audioBase64: "data:audio/wav;base64,..." } eller tydligt fel.

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost({ request, env }) {
  try {
    const { text } = await request.json();
    if (!text) {
      return Response.json(
        { ok: false, error: "text saknas", status: 400 },
        { status: 400, headers: corsHeaders() }
      );
    }

    // Här kopplar du in ElevenLabs eller annan TTS.
    if (!env.ELEVENLABS_API_KEY) {
      // Skicka demo-svar som gör att frontend fungerar (ingen 405).
      return Response.json(
        { ok: false, error: "ELEVENLABS_API_KEY saknas i miljön", status: 501 },
        { status: 501, headers: corsHeaders() }
      );
    }

    // TODO: Implementera riktig TTS. Exemplet nedan är bara en stub.
    // const audioBase64 = "data:audio/wav;base64,....";
    // return Response.json({ ok:true, audioBase64 }, { headers: corsHeaders() });

    return Response.json(
      { ok: false, error: "TTS ej implementerad ännu (nyckel finns).", status: 501 },
      { status: 501, headers: corsHeaders() }
    );
  } catch (err) {
    return Response.json(
      { ok: false, error: `Serverfel: ${err.message}`, status: 500 },
      { status: 500, headers: corsHeaders() }
    );
  }
}
