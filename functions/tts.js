// /functions/tts.js
// BN Kids — TTS via ElevenLabs, optimerad för svenska.
// - En röst (styrd via ELEVENLABS_VOICE_ID i wrangler.toml)
// - Svenska-preferenser (stability/similarity/style/speakerBoost)
// - ?nocache=1 för att hoppa över cache när du labbar
// - Cache i D1 (tts_cache) + MP3 i R2 (bn-audio)

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
    const url = new URL(request.url);

    // ---- Läs in text ----
    let text = (url.searchParams.get("q") || "").toString();
    if (request.method === "POST") {
      try {
        const body = await request.json();
        if (body?.text) text = String(body.text);
      } catch {
        /* ignorera */
      }
    }
    text = (text || "").trim();
    if (!text) {
      return jerr(400, "Missing text. Provide ?q=... or POST { text }.", null, origin);
    }

    // ---- Miljö & svenska defaults ----
    const apiKey  = env.ELEVENLABS_API_KEY;
    const voiceId = env.ELEVENLABS_VOICE_ID; // en enda röst
    const modelId = env.ELEVENLABS_MODEL || "eleven_turbo_v2";

    // Svenska-tuned defaults (kan överstyras via vars eller query):
    const stability  = num(env.ELEVENLABS_STABILITY,  url.searchParams.get("stability"),  0.25);
    const similarity = num(env.ELEVENLABS_SIMILARITY, url.searchParams.get("similarity"), 0.85);
    const style      = num(env.ELEVENLABS_STYLE,      url.searchParams.get("style"),      0.35);
    const speakerBoost = bool(env.ELEVENLABS_SPEAKER_BOOST, url.searchParams.get("speaker_boost"), true);

    const noCache = url.searchParams.get("nocache") === "1";

    if (!apiKey || !voiceId) {
      return jerr(500, "Missing env config", {
        has_api_key: !!apiKey,
        has_voice_id: !!voiceId
      }, origin);
    }

    // Tips till ElevenLabs: markera att texten ska läsas på svenska.
    // (Fungerar som en lätt “hint” och påverkar inte outputen om texten redan är svensk.)
    const textForTTS = `[[svenska]] ${text}`;

    // ---- Cache-nyckel (inkluderar alla settings) ----
    const settingsKey = `${modelId}|${stability}|${similarity}|${style}|${speakerBoost}`;
    const keyHash = await sha256Hex(`${voiceId}::${settingsKey}::${textForTTS}`);
    const r2Key   = `tts/${keyHash}.mp3`;

    // ---- D1 + R2 cache-läsning (om inte nocache=1) ----
    if (!noCache) {
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
      } catch { /* cachefel ska inte hindra ny generering */ }
    }

    // ---- ElevenLabs-anrop ----
    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        text: textForTTS,
        model_id: modelId,
        // Optimize latency (0-4). 0 = snabbast. Låt default vara 0 för låg lagg.
        optimize_streaming_latency: 0,
        voice_settings: {
          stability,
          similarity_boost: similarity,
          style,
          use_speaker_boost: speakerBoost
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

    // ---- Spara i R2 + skriv cache-index i D1 ----
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
        .bind(voiceId, textForTTS, keyHash, r2Key, audio.byteLength)
        .run();
    } catch { /* best-effort */ }

    // ---- Returnera MP3 ----
    return new Response(audio, {
      status: 200,
      headers: { "content-type": "audio/mpeg", ...cors(origin) }
    });

  } catch (err) {
    return jerr(500, "TTS server error", { message: String(err?.message || err) });
  }
}

/* ---------- Helpers ---------- */
function num(envVal, qVal, fallback) {
  const v = qVal ?? envVal;
  const f = parseFloat(v);
  return Number.isFinite(f) ? f : fallback;
}
function bool(envVal, qVal, fallback) {
  const raw = (qVal ?? envVal);
  if (raw === undefined || raw === null || raw === "") return !!fallback;
  const s = String(raw).toLowerCase();
  return !(s === "0" || s === "false" || s === "no");
}
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
D1-tabell (om saknas):
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
