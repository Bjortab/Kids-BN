// functions/tts.js
const CORS = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
});

export const onRequestOptions = async ({ env, request }) => {
  const origin = env?.BN_ALLOWED_ORIGIN || new URL(request.url).origin;
  return new Response(null, { status: 204, headers: CORS(origin) });
};

export const onRequestGet = async ({ env, request }) => {
  const origin = env?.BN_ALLOWED_ORIGIN || new URL(request.url).origin;
  return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json", ...CORS(origin) },
  });
};

export const onRequestPost = async ({ env, request }) => {
  const origin = env?.BN_ALLOWED_ORIGIN || new URL(request.url).origin;

  try {
    if (!(request.headers.get("content-type") || "").includes("application/json")) {
      return new Response(JSON.stringify({ error: "Content-Type must be application/json" }), {
        status: 415,
        headers: { "Content-Type": "application/json", ...CORS(origin) },
      });
    }

    const { text, voiceId } = await request.json();
    if (!text || !text.trim()) {
      return new Response(JSON.stringify({ error: "Missing text" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS(origin) },
      });
    }

    // ===== 1) ELEVENLABS (svenska) =====
    if (env?.ELEVENLABS_API_KEY) {
      const vId = voiceId || env?.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // byt till din svenska röst
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vId)}`;

      const body = JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",       // rätt modell för sv
        output_format: "mp3_44100_128",
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.75,
          style: 0.15,
          use_speaker_boost: true
        }
      });

      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Accept": "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": env.ELEVENLABS_API_KEY
        },
        body
      });

      if (r.ok) {
        const ab = await r.arrayBuffer();
        return new Response(ab, {
          status: 200,
          headers: { "Content-Type": "audio/mpeg", "Content-Length": String(ab.byteLength), ...CORS(origin) }
        });
      } else {
        const errTxt = await r.text().catch(() => "");
        console.warn("ElevenLabs TTS failed:", r.status, errTxt);
      }
    }

    // ===== 2) Fallback: OpenAI TTS =====
    if (env?.OPENAI_API_KEY) {
      const oai = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          voice: "alloy",
          input: text,
          format: "mp3"
        })
      });

      if (oai.ok) {
        const ab = await oai.arrayBuffer();
        return new Response(ab, {
          status: 200,
          headers: { "Content-Type": "audio/mpeg", "Content-Length": String(ab.byteLength), ...CORS(origin) }
        });
      } else {
        const t = await oai.text().catch(() => "");
        return new Response(JSON.stringify({ error: `OpenAI TTS failed: ${oai.status}`, details: t }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...CORS(origin) }
        });
      }
    }

    return new Response(JSON.stringify({ error: "No TTS provider configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS(origin) }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS(origin) }
    });
  }
};
