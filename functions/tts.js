// BN Kids TTS — Golden Copy v1.6.0 (stabil version med röst & R2-cache)

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { text } = await request.json();

    if (!text) {
      return new Response(JSON.stringify({ ok: false, error: "Missing text" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const voiceId = env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
    const apiKey  = env.ELEVENLABS_API_KEY;
    const r2      = env["bn-audio"] || env.BN_AUDIO;

    const key = await hashKey(`${voiceId}:${text}`);

    // --- cache check --------------------------------------------------------
    if (r2) {
      const cached = await r2.get(key);
      if (cached) {
        return new Response(cached.body, {
          headers: {
            "content-type": "audio/mpeg",
            "x-tts-cache": "HIT",
            "x-tts-key": key,
          },
        });
      }
    }

    // --- generate via ElevenLabs -------------------------------------------
    const elUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?optimize_streaming_latency=0&output_format=mp3_44100_128`;

    const res = await fetch(elUrl, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.9,
          style: 0.0,
        },
      }),
    });

    if (!res.ok) {
      const msg = await res.text();
      return new Response(JSON.stringify({ ok: false, error: msg }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    const buf = await res.arrayBuffer();

    // --- save in R2 ---------------------------------------------------------
    if (r2) {
      await r2.put(key, buf, { httpMetadata: { contentType: "audio/mpeg" } });
    }

    return new Response(buf, {
      headers: {
        "content-type": "audio/mpeg",
        "x-tts-cache": "MISS",
        "x-tts-key": key,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

async function hashKey(input) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}
