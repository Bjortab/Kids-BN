export default {
  async fetch(req, env) {
    try {
      // ======== Input ========
      const { text, voiceId, speed } = await req.json();

      if (!text || typeof text !== "string") {
        return new Response(JSON.stringify({ ok: false, error: "Ingen text angiven" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // ======== Cache-setup ========
      const cache = caches.default;
      const cacheKey = new Request(`https://bn-tts-cache/${voiceId || "default"}/${encodeURIComponent(text)}`);
      let hits = 0, total = 1;

      // Kolla om det redan finns en cache-träff
      const cached = await cache.match(cacheKey);
      if (cached) {
        hits = 1;
        const headers = new Headers(cached.headers);
        headers.set("x-tts-hits", hits);
        headers.set("x-tts-total", total);
        return new Response(cached.body, { headers });
      }

      // ======== Bygg ElevenLabs-anrop ========
      const apiKey = env.ELEVENLABS_API_KEY;
      if (!apiKey)
        return new Response(JSON.stringify({ ok: false, error: "Saknar ELEVENLABS_API_KEY" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });

      const model = "eleven_turbo_v2"; // stabil version
      const voice = voiceId || env.ELEVENLABS_VOICE_ID || "Swedish"; // fallback till svensk röst
      const playbackSpeed = speed && !isNaN(speed) ? parseFloat(speed) : 1.0;

      // ======== ElevenLabs API-anrop ========
      const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: model,
          voice_settings: {
            stability: 0.3,
            similarity_boost: 0.8,
            style: 0.4,
            use_speaker_boost: true,
          },
          // Språk och tempo
          voice_language: "sv-SE",
          optimize_streaming_latency: 0,
          playback_speed: playbackSpeed,
        }),
      });

      if (!ttsRes.ok) {
        const errText = await ttsRes.text();
        return new Response(JSON.stringify({ ok: false, error: errText }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      // ======== Cacha & returnera ========
      const audioBuffer = await ttsRes.arrayBuffer();
      const resHeaders = new Headers({
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=31536000",
        "x-tts-hits": hits,
        "x-tts-total": total,
      });

      const response = new Response(audioBuffer, { headers: resHeaders });
      await cache.put(cacheKey, response.clone());

      return response;

    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message || "TTS-fel" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
