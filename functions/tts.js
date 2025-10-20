/**
 * BN Kids TTS v1.2 – ElevenLabs + R2 cache (safe & robust)
 * - Keeps v1.1 behavior (speed 1.25x, same model), but hardens caching.
 * - Finds the right R2 binding automatically (BN_AUDIOS, bn-audio, etc.).
 * - Normalizes text before hashing so spacing/casing glitches still hit cache.
 * - Adds X-Cache and X-Cache-Key headers for easy debugging in DevTools.
 */

export async function onRequestPost({ request, env }) {
  try {
    const { text = "" } = await request.json();

    // --- ENV / bindings ---
    const elevenKey = env.ELEVENLABS_API_KEY;
    const voiceId =
      env.ELEVENLABS_VOICE_ID || "ASuLN9XzvLEY9pEM9nLGz7"; // your default voice

    // Try several common binding names so we don't break if wrangler.toml differs
    const bucket =
      env.BN_AUDIOS ||
      env["bn-audio"] ||
      env.bn_audio ||
      env.bnAudios ||
      env.R2 ||
      null;

    if (!elevenKey) {
      return jsonErr("ELEVENLABS_API_KEY saknas", 500);
    }

    // --- Normalize text so tiny diffs still cache ---
    const norm = normalizeForCache(text);
    const { hash, key } = await cacheKey(norm); // key like "tts/<sha256>.mp3"

    // --- Try R2 cache first ---
    if (bucket) {
      const head = await bucket.head(key);
      if (head) {
        const obj = await bucket.get(key);
        const buf = await obj.arrayBuffer();
        return new Response(buf, {
          headers: {
            "Content-Type": "audio/mpeg",
            "X-Cache": "HIT",
            "X-Cache-Key": key,
          },
        });
      }
    }

    // --- ElevenLabs request (stream) ---
    const api = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;
    const res = await fetch(api, {
      method: "POST",
      headers: {
        "xi-api-key": elevenKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: norm,
        model_id: "eleven_turbo_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          style: "narration",
          speed: 1.25, // keep your faster pace
        },
      }),
    });

    if (!res.ok) {
      const errTxt = await res.text().catch(() => "");
      throw new Error(`TTS API-fel ${res.status}: ${errTxt}`);
    }

    const audio = await res.arrayBuffer();

    // --- Save to R2 for future hits ---
    if (bucket) {
      await bucket.put(key, audio, {
        httpMetadata: { contentType: "audio/mpeg" },
      });
    }

    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "X-Cache": "MISS",
        "X-Cache-Key": key,
      },
    });
  } catch (err) {
    console.error("❌ TTS-fel:", err);
    return jsonErr(String(err?.message || err), 500);
  }
}

/* ---------- helpers ---------- */

function jsonErr(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// collapse spaces, strip invisibles and trim – keeps diacritics & Swedish chars
function normalizeForCache(input) {
  return String(input)
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width chars
    .replace(/\s+/g, " ")
    .trim();
}

async function cacheKey(normalizedText) {
  const enc = new TextEncoder();
  const bytes = enc.encode(normalizedText);
  const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(hashBuf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { hash, key: `tts/${hash}.mp3` };
}
