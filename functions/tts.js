// /functions/api/tts.js
// BN Kids – ElevenLabs TTS med en röst, D1-cache och R2-lagring.
//
// ENV (wrangler.toml [vars]):
//   ELEVENLABS_VOICE_ID  = "..."             // din röst-ID
//   ELEVENLABS_MODEL     = "eleven_turbo_v2" (valfritt)
//
// SECRETS (Cloudflare):
//   ELEVENLABS_API_KEY    = "sk-...."
//
// Beroenden i Cloudflare:
//   - D1:  env.BN_DB  (tabell tts_cache, se SQL nedan)
//   - R2:  env["bn-audio"]

function cors(origin = "*") {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization",
  };
}

export async function onRequest({ request, env }) {
  const origin = "*";
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: cors(origin) });
  }

  try {
    // ------- Inläsning -------
    const url = new URL(request.url);
    let text = (url.searchParams.get("q") || "").toString();

    if (request.method === "POST") {
      try {
        const body = await request.json();
        if (body?.text) text = String(body.text);
      } catch { /* ignorera body-fel */ }
    }

    text = (text || "").trim();
    if (!text) {
      return jerr(400, "Missing text. Provide ?q=... or POST { text }.", null, origin);
    }

    // ------- Miljövariabler -------
    const apiKey  = env.ELEVENLABS_API_KEY;
    const voiceId = env.ELEVENLABS_VOICE_ID;
    const modelId = env.ELEVENLABS_MODEL || "eleven_turbo_v2";

    if (!apiKey || !voiceId) {
      return jerr(500, "Missing env config", {
        has_api_key: !!apiKey,
        has_voice_id: !!voiceId
      }, origin);
    }

    // ------- Cache-nyckel (text + modell + röst) -------
    const keyHash = await sha256Hex(`${voiceId}::${modelId}::${text}`);
    const r2Key   = `tts/${keyHash}.mp3`;

    // ------- Försök hämta från cache (D1 + R2) -------
    try {
      const row = await env.BN_DB
        .prepare("SELECT r2_key FROM tts_cache WHERE hash = ?")
        .bind(keyHash)
        .first();
      if (row?.r2_key) {
        const obj = await env["bn-audio"].get(row.r2_key);
        if (obj) {
          return new Response(obj.body, {
            status: 200,
            headers: { "content-type": "audio/mpeg", ...cors(origin) }
          });
        }
      }
    } catch { /* cachefel ska inte stoppa generering */ }

    // ------- ElevenLabs-anrop -------
    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return jerr(502, "ElevenLabs API error", {
        status: resp.status,
        model: modelId,
        body: safeParse(errText)
      }, origin);
    }

    // ------- Lagra i R2 och uppdatera D1-cache -------
    const audio = await resp.arrayBuffer();
    await env["bn-audio"].put(r2Key, audio, {
      httpMetadata: { contentType: "audio/mpeg" }
    });

    try {
      await env.BN_DB
        .prepare(`
          INSERT INTO tts_cache (voice, phrase, hash, r2_key, bytes)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(hash) DO UPDATE
          SET r2_key = excluded.r2_key, bytes = excluded.bytes
        `)
        .bind(voiceId, text, keyHash, r2Key, audio.byteLength)
        .run();
    } catch { /* best-effort */ }

    // ------- Svara med MP3 -------
    return new Response(audio, {
      status: 200,
      headers: { "content-type": "audio/mpeg", ...cors(origin) }
    });

  } catch (err) {
    return jerr(500, "TTS server error", { message: String(err?.message || err) });
  }
}

/* ---------- Helpers ---------- */
async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function safeParse(t) { try { return JSON.parse(t); } catch { return t; } }
function jerr(status, error, extra = null, origin = "*") {
  return new Response(JSON.stringify({ error, ...(extra ? { extra } : {}) }, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors(origin) }
  });
}

/*
SQL för D1 (om tabellen saknas):

CREATE TABLE IF NOT EXISTS tts_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voice TEXT,
  phrase TEXT,
  hash TEXT UNIQUE,
  r2_key TEXT,
  bytes INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
*/
