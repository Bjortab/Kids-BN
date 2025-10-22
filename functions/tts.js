// /functions/tts.js
// BN-Kids — Google Cloud Text-to-Speech via REST + R2-cache (per hel saga)
//
// ENV (Cloudflare Pages):
//   R2 binding:  BN_AUDIO
//   Secret:      GOOGLE_TTS_API_KEY
//   Variable:    (valfritt) GOOGLE_TTS_LANGUAGE = sv-SE
//   Variable:    (valfritt) GOOGLE_TTS_VOICE    = sv-SE-Wavenet-B (t.ex.)
//
// POST /tts body:
//   { text, reuse, voice?, languageCode?, speakingRate?, pitch?, volumeGainDb?, effectsProfileId?[] }
//
// Svar: audio/mpeg + X-Tts-Cache: HIT|MISS + X-Tts-Version: 1

export const onRequestPost = async ({ request, env }) => {
  try {
    if (!env.GOOGLE_TTS_API_KEY) return jerr("Missing GOOGLE_TTS_API_KEY", 500);

    const body = await request.json();
    const text = (body?.text || "").trim();
    if (!text) return jerr("Missing 'text'", 400);

    const languageCode = body.languageCode || env.GOOGLE_TTS_LANGUAGE || "sv-SE";
    const voice = body.voice || env.GOOGLE_TTS_VOICE || "sv-SE-Wavenet-B"; // lite varmare default
    const speakingRate = isNum(body.speakingRate) ? Number(body.speakingRate) : 1.0;
    const pitch = isNum(body.pitch) ? Number(body.pitch) : 0.0;
    const volumeGainDb = isNum(body.volumeGainDb) ? Number(body.volumeGainDb) : 0.0;
    const effectsProfileId = Array.isArray(body.effectsProfileId) ? body.effectsProfileId : undefined;
    const reuse = body.reuse === true;

    // ✱ DO NOT TOUCH: CACHE CONTRACT ✱
    const key = await buildCacheKey(
      { text, voice, languageCode, speakingRate, pitch, volumeGainDb, effectsProfileId },
      { reuse }
    );

    // 1) R2 cache read
    if (env.BN_AUDIO) {
      const hit = await env.BN_AUDIO.get(key);
      if (hit) {
        return new Response(hit.body, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Tts-Cache": "HIT",
            "X-Tts-Version": "1",
            "X-R2-Key": key
          }
        });
      }
    }

    // 2) Google TTS
    const gBody = {
      input:  { text },
      voice:  { languageCode, name: voice },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate,
        pitch,
        volumeGainDb,
        ...(effectsProfileId ? { effectsProfileId } : {})
      }
    };

    const gRes = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(env.GOOGLE_TTS_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gBody)
      }
    );

    if (!gRes.ok) {
      const errTxt = await gRes.text().catch(() => "");
      return jerr(`Google TTS error ${gRes.status}: ${errTxt.slice(0, 600)}`, 502);
    }

    const gJson = await gRes.json();
    const base64 = gJson?.audioContent;
    if (!base64) return jerr("No audioContent from Google TTS", 502);

    const audioBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const mp3 = new Blob([audioBytes], { type: "audio/mpeg" });

    // 3) Cache write
    if (env.BN_AUDIO) {
      await env.BN_AUDIO.put(key, mp3.stream(), {
        httpMetadata: {
          contentType: "audio/mpeg",
          cacheControl: "public, max-age=31536000, immutable"
        }
      });
    }

    return new Response(mp3.stream(), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Tts-Cache": "MISS",
        "X-Tts-Version": "1",
        "X-R2-Key": key
      }
    });

  } catch (err) {
    return jerr(err?.message || "Unexpected error", 500);
  }
};

// ===== Helpers =====
function jerr(message, status = 500) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
function isNum(v) { return v !== null && v !== undefined && !Number.isNaN(Number(v)); }

// ✱ DO NOT TOUCH: CACHE CONTRACT ✱
async function buildCacheKey(obj, { reuse } = {}) {
  const enc = new TextEncoder();
  const base = JSON.stringify(obj);
  const salt = reuse === true ? "" : `|salt:${crypto.getRandomValues(new Uint32Array(1))[0]}`;
  const payload = base + salt;
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(payload));
  const hash = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  return `gcloud/${hash}.mp3`;
}
