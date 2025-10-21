// functions/tts.js  — ElevenLabs TTS + R2-cache (Pages Functions)
// Kräver bindings/secrets i Wrangler/Pages:
//   [[r2_buckets]] binding = "BN_AUDIO" bucket_name = "bn-audio"
//   [vars] ELEVENLABS_VOICE_ID = "<din standardröst>"
//   [vars] (valfritt)  MODEL_TTS = "eleven_multilingual_v2"
//   [secrets] ELEVENLABS_API_KEY = "<din api-nyckel>"

export async function onRequestGet() {
  return jsonErr(405, "Method Not Allowed");
}

export async function onRequestOptions() {
  // (ej nödvändigt normalt, men gör den tyst)
  return new Response(null, { status: 204 });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonErr(400, "Bad JSON");
  }

  const text  = (body?.text ?? "").toString().trim();
  const speed = clamp(Number(body?.speed ?? 1.0), 0.5, 2.0);

  // röst: inputfältet vinner; annars Wrangler-variabeln
  const voiceId = ((body?.voiceId ?? env.ELEVENLABS_VOICE_ID) || "").trim();

  if (!text)    return jsonErr(400, "Missing 'text'");
  if (!voiceId) return jsonErr(400, "Missing 'voiceId' (or ELEVENLABS_VOICE_ID not set)");

  const model = (env.MODEL_TTS || "eleven_multilingual_v2");

  // --- Cache-nyckel (hash på röst + speed + text) ---
  const key = await hashKey(`${voiceId}|${speed}|${text}`);
  const objKey = `tts/${key}.mp3`;

  // --- R2 HIT? ---
  try {
    const hit = await env.BN_AUDIO.get(objKey);
    if (hit) {
      return new Response(hit.body, {
        status: 200,
        headers: {
          "content-type": "audio/mpeg",
          "cache-control": "no-store",
          "x-tts-cache": "HIT",
          "x-tts-key": `${key}.mp3`,
        },
      });
    }
  } catch {
    // ignorera R2-fel, vi försöker ändå generera
  }

  // --- Generera via ElevenLabs ---
  if (!env.ELEVENLABS_API_KEY) return jsonErr(500, "ELEVENLABS_API_KEY saknas");

  const payload = {
    text,
    model_id: model,
    // tala lite snabbare som standard – justerbart från klienten
    voice_settings: {
      stability: 0.45,
      similarity_boost: 0.85,
      style: 0.0,
      speaking_rate: speed, // 0.5–2.0
    },
    // optimerad kvalitet (inte streaming)
    generation_config: { chunk_length_schedule: [ 240, 240, 240 ] },
  };

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?optimize_streaming_latency=0&output_format=mp3_44100_128`;

  let mp3Buffer;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": env.ELEVENLABS_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      // ElevenLabs skickar JSON med felinfo
      let detail = "";
      try { detail = JSON.stringify(await res.json()); } catch { /* ignore */ }
      return jsonErr(400, `ElevenLabs ${res.status} ${detail || "(no body)"}`);
    }
    mp3Buffer = await res.arrayBuffer();
  } catch (e) {
    return jsonErr(502, `Upstream error: ${e?.message || e}`);
  }

  // --- Spara i R2 & svara ---
  try {
    await env.BN_AUDIO.put(objKey, mp3Buffer, {
      httpMetadata: { contentType: "audio/mpeg" },
    });
  } catch /* istf att falla: leverera ändå */ {}

  return new Response(mp3Buffer, {
    status: 200,
    headers: {
      "content-type": "audio/mpeg",
      "cache-control": "no-store",
      "x-tts-cache": "MISS",
      "x-tts-key": `${key}.mp3`,
    },
  });
}

// ===== helpers =====
function jsonErr(status, message) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function clamp(n, lo, hi) {
  return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}

async function hashKey(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 32);
}
