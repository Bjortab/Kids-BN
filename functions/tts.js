export const onRequestPost = async (ctx) => {
  const { request, env } = ctx;

  // === Helpers ==============================================================
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });

  const textHash = async (s) => {
    const d = new TextEncoder().encode(s);
    const b = await crypto.subtle.digest("SHA-256", d);
    return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, "0")).join("");
  };

  try {
    // === Input ==============================================================
    const body = await request.json().catch(() => ({}));
    const text = (body?.text || "").toString().trim();
    const voiceOverride = (body?.voiceId || "").trim();

    if (!text) return json({ ok: false, error: "Missing 'text'." }, 400);

    // Röst: input > ENV
    const voiceId = voiceOverride || (env.ELEVENLABS_VOICE_ID || "").trim();
    if (!voiceId) {
      return json({ ok: false, error: "Missing 'voiceId' (ELEVENLABS_VOICE_ID not set?)" }, 400);
    }

    // === Cache-nyckel i R2 ==================================================
    // OBS: BN_AUDIO måste vara en R2-binding till din bucket "bn-audio"
    const cacheKey = `tts/${voiceId}/${await textHash(text)}.mp3`;

    if (env.BN_AUDIO) {
      const hit = await env.BN_AUDIO.get(cacheKey);
      if (hit) {
        return new Response(hit.body, {
          status: 200,
          headers: {
            "content-type": "audio/mpeg",
            "x-tts-cache": "HIT",
            "x-tts-key": cacheKey,
          },
        });
      }
    }

    // === ElevenLabs call ====================================================
    const apiKey = env.ELEVENLABS_API_KEY || env.ELEVENLABS_TOKEN;
    if (!apiKey) return json({ ok: false, error: "Missing ELEVENLABS_API_KEY" }, 400);

    const elUrl = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
      voiceId
    )}?optimize_streaming_latency=3&output_format=mp3_44100_128`;

    const elRes = await fetch(elUrl, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        voice_settings: { stability: 0.35, similarity_boost: 0.8, style: 0, use_speaker_boost: true },
      }),
    });

    if (!elRes.ok) {
      const maybeJson = await elRes.text();
      return json(
        { ok: false, error: `ElevenLabs fail ${elRes.status}`, detail: maybeJson?.slice(0, 800) },
        500
      );
    }

    // Spara i R2 om möjligt
    const audioBuf = await elRes.arrayBuffer();
    if (env.BN_AUDIO) {
      await env.BN_AUDIO.put(cacheKey, audioBuf, {
        httpMetadata: { contentType: "audio/mpeg" },
      });
    }

    return new Response(audioBuf, {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "x-tts-cache": env.BN_AUDIO ? "MISS" : "BYPASS",
        "x-tts-key": cacheKey,
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: "TTS crash", detail: String(err).slice(0, 800) }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
};
