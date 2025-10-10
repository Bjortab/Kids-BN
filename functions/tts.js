// functions/api/tts.js
// Tar emot { text, voiceId? } → svarar { ok, audioBase64 } (MPEG)

const CORS = (env) => ({
  "Access-Control-Allow-Origin": env?.BN_ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
});

export async function onRequestOptions({ env }) {
  return new Response(null, { status: 204, headers: CORS(env) });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.ELEVENLABS_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "ELEVENLABS_API_KEY saknas" }), {
        status: 500, headers: { "Content-Type": "application/json", ...CORS(env) }
      });
    }
    const { text, voiceId } = await request.json();
    if (!text) {
      return new Response(JSON.stringify({ ok: false, error: "Ingen text att läsa" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS(env) }
      });
    }
    const vid = voiceId || env.DEFAULT_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // example fallback

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`, {
      method: "POST",
      headers: {
        "xi-api-key": env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        model_id: env.ELEVENLABS_VOICE_MODEL || "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ ok: false, error: `ElevenLabs ${res.status}: ${err}` }), {
        status: 500, headers: { "Content-Type": "application/json", ...CORS(env) }
      });
    }

    const arrayBuf = await res.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));

    return new Response(JSON.stringify({ ok: true, audioBase64: `data:audio/mpeg;base64,${b64}` }), {
      headers: { "Content-Type": "application/json", ...CORS(env) }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS(env) }
    });
  }
}

export async function onRequest() {
  return new Response("Method Not Allowed", { status: 405 });
}
