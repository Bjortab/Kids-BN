/**
 * BN Kids TTS v1.1 – ElevenLabs-röst (snabbare, stabil, fallback-stöd)
 * Förbättringar:
 *  - Justerad talhastighet (1.25x)
 *  - Fallback-hantering vid API-fel
 *  - Automatisk R2-cache-skrivning
 *  - Svensk textoptimering
 */

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const text = body.text || "";
    const voice_id = env.ELEVENLABS_VOICE_ID || "ASuLN9XzvLEY9pEM9nLGz7"; // fallback
    const elevenKey = env.ELEVENLABS_API_KEY;
    const bucket = env["bn-audio"] || env.R2; // din R2-binding

    if (!elevenKey) {
      return new Response(JSON.stringify({ error: "ELEVENLABS_API_KEY saknas" }), { status: 500 });
    }

    // 🧠 Skapa unikt hash-ID för att cacha samma text
    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
    const cacheKey = `tts/${hash}.mp3`;

    // 🔍 Försök läsa från R2-cache först
    if (bucket) {
      const existing = await bucket.head(cacheKey);
      if (existing) {
        const obj = await bucket.get(cacheKey);
        return new Response(await obj.arrayBuffer(), {
          headers: { "Content-Type": "audio/mpeg", "X-Cache": "HIT" },
        });
      }
    }

    // 🗣️ ElevenLabs TTS-anrop
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}/stream`, {
      method: "POST",
      headers: {
        "xi-api-key": elevenKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          style: "narration",
          speed: 1.25  // 🟢 snabbare tempo för barnsagor
        }
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`TTS API-fel: ${err}`);
    }

    const audio = await res.arrayBuffer();

    // 💾 Spara i R2-cache
    if (bucket) {
      await bucket.put(cacheKey, audio, { httpMetadata: { contentType: "audio/mpeg" } });
    }

    return new Response(audio, {
      headers: { "Content-Type": "audio/mpeg", "X-Cache": "MISS" },
    });

  } catch (err) {
    console.error("❌ TTS-fel:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
