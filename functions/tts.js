// /functions/tts.js
// BN-Kids — Google Cloud Text-to-Speech via REST + R2-cache (per hel saga)
//
// ENV som krävs (Cloudflare Pages):
//   R2 binding:  BN_AUDIO  -> din R2-bucket med ljud (t.ex. bn-audio)
//   Secret:      GOOGLE_TTS_API_KEY
//   Variable:    (valfritt) GOOGLE_TTS_LANGUAGE = sv-SE
//   Variable:    (valfritt) GOOGLE_TTS_VOICE    = sv-SE-Wavenet-A  (man) eller sv-SE-Wavenet-D (kvinna)
//
// API-kontrakt (låst):
//   POST /tts
//   Body: {
//     "text": "<hela sagan>",
//     "reuse": false,                      // false = ny key (cache stör inte), true = återanvänd exakt text/röst
//     "voice": "sv-SE-Wavenet-A",          // valfritt, annars GOOGLE_TTS_VOICE
//     "languageCode": "sv-SE",             // valfritt, annars GOOGLE_TTS_LANGUAGE
//     "speakingRate": 1.0,                 // valfritt
//     "pitch": 0.0,                        // valfritt
//     "volumeGainDb": 0.0                  // valfritt
//   }
//   Response: audio/mpeg
//   Headers:  X-Tts-Cache: HIT|MISS
//             X-Tts-Version: 1
//             X-R2-Key: <cache-key>
//
// ✱ DO NOT TOUCH: CACHE CONTRACT ✱
//  - buildCacheKey(obj, { reuse })
//  - headers X-Tts-Cache, X-Tts-Version
//  - alltid audio/mpeg på OK-respons

export const onRequestPost = async ({ request, env }) => {
  try {
    // --- sanity check på env
    if (!env.GOOGLE_TTS_API_KEY) {
      return jerr("Missing GOOGLE_TTS_API_KEY", 500);
    }

    const body = await request.json();
    const text = (body?.text || "").trim();
    if (!text) return jerr("Missing 'text'", 400);

    const languageCode = body.languageCode || env.GOOGLE_TTS_LANGUAGE || "sv-SE";
    const voice = body.voice || env.GOOGLE_TTS_VOICE || "sv-SE-Wavenet-A";
    const speakingRate = isNum(body.speakingRate) ? Number(body.speakingRate) : 1.0;
    const pitch = isNum(body.pitch) ? Number(body.pitch) : 0.0;
    const volumeGainDb = isNum(body.volumeGainDb) ? Number(body.volumeGainDb) : 0.0;
    const reuse = body.reuse === true;

    // ✱ DO NOT TOUCH: CACHE CONTRACT ✱
    const key = await buildCacheKey(
      { text, voice, languageCode, speakingRate, pitch, volumeGainDb },
      { reuse }
    );

    // 1) Cache read (R2)
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

    // 2) Google Cloud TTS
    const gBody = {
      input: { text },
      voice: { languageCode, name: voice },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate,
        pitch,
        volumeGainDb
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

    // 3) Cache write (R2) — skriv alltid, även om reuse=false (bra för “Spela igen”)
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

// ===== Helpers ===============================================================
function jerr(message, status = 500) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function isNum(v) {
  return v !== null && v !== undefined && !Number.isNaN(Number(v));
}

// ✱ DO NOT TOUCH: CACHE CONTRACT ✱
async function buildCacheKey(obj, { reuse } = {}) {
  const enc = new TextEncoder();
  // När reuse==true: ingen salt -> identiskt text+voice => samma nyckel (HIT)
  // När reuse!=true: addera salt -> tvinga ny version (MISS)
  const base = JSON.stringify(obj);
  const salt = reuse === true ? "" : `|salt:${crypto.getRandomValues(new Uint32Array(1))[0]}`;
  const payload = base + salt;
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(payload));
  const hash = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  return `gcloud/${hash}.mp3`;
}
