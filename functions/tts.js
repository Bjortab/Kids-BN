// TTS endpoint med R2-prefix
// POST /tts  { text, voice? }  -> { id }
// GET  /tts?id=<id>            -> streamar MP3

export async function onRequestPost({ request, env }) {
  const allow = env.KIDSBN_ALLOWED_ORIGIN || "*";
  try {
    const { text, voice } = await request.json();
    if (!text || !text.trim()) {
      return new Response(JSON.stringify({ error: "Missing text" }), {
        status: 400,
        headers: cors(allow),
      });
    }

    // Om ingen server-TTS-nyckel: signalera att webbläsar-TTS ska användas
    if (!env.ELEVENLABS_API_KEY) {
      return new Response(
        JSON.stringify({ error: "TTS disabled (no ELEVENLABS_API_KEY)" }),
        { status: 501, headers: cors(allow) }
      );
    }

    const id = crypto.randomUUID();
    const prefix = (env.AUDIO_PREFIX || "tts/").replace(/^\/+|\/+$/g, "");
    const key = `${prefix}/${id}.mp3`;

    // ElevenLabs – enkel standardröst (kan styras via env)
    const voiceId =
      env.ELEVENLABS_VOICE_ID ||
      "EXAVITQu4vr4xnSDxMaL"; // "Rachel" (fallback som brukar finnas)

    const body = {
      text: text.slice(0, 5000),
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    };

    const ttsRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?optimize_streaming_latency=2`,
      {
        method: "POST",
        headers: {
          "xi-api-key": env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify(body),
      }
    );

    if (!ttsRes.ok) {
      const t = await ttsRes.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: "TTS failed", details: t }),
        { status: 502, headers: cors(allow) }
      );
    }

    // Spara till R2
    const stream = ttsRes.body; // ReadableStream
    await env["bn-audio"].put(key, stream, {
      httpMetadata: { contentType: "audio/mpeg" },
    });

    return new Response(JSON.stringify({ id }), {
      status: 200,
      headers: cors(allow),
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "Server error" }), {
      status: 500,
      headers: cors(allow),
    });
  }
}

export async function onRequestGet({ request, env }) {
  const allow = env.KIDSBN_ALLOWED_ORIGIN || "*";
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) {
      // HEAD health-check support
      if (request.method === "HEAD") {
        return new Response(null, {
          status: 204,
          headers: { "x-kidsbn-mode": env.KIDSBN_MODE || "mock", ...cors(allow) },
        });
      }
      return new Response(JSON.stringify({ error: "Missing id" }), {
        status: 400,
        headers: cors(allow),
      });
    }

    const prefix = (env.AUDIO_PREFIX || "tts/").replace(/^\/+|\/+$/g, "");
    const key = `${prefix}/${id}.mp3`;

    const obj = await env["bn-audio"].get(key);
    if (!obj) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: cors(allow),
      });
    }

    return new Response(obj.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
        ...cors(allow),
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "Server error" }), {
      status: 500,
      headers: cors(allow),
    });
  }
}

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
