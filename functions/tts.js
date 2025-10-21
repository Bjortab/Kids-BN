export const config = {
  path: "/tts"
};

/**
 * POST /tts
 * Body: { text:string, voiceId?:string, speed?:number }
 * Kräver R2 bindingar: BN_AUDIO (bucket) och secret ELEVENLABS_API_KEY
 * Optional: default voice via env.ELEVENLABS_VOICE_ID
 */
export async function onRequestPost(context) {
  const { request, env } = context;

  // --- Guard: R2 bindingar finns?
  if (!env.BN_AUDIO) {
    return json({ ok:false, error:"R2 binding BN_AUDIO saknas" }, 500);
  }
  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return json({ ok:false, error:"ELEVENLABS_API_KEY saknas" }, 500);
  }

  // --- Input
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const text    = (body?.text || "").trim();
  const voiceId = (body?.voiceId || env.ELEVENLABS_VOICE_ID || "").trim();
  const speed   = Number.isFinite(+body?.speed) ? Math.max(0.5, Math.min(2, +body.speed)) : 1.0;

  if (!text)   return json({ ok:false, error:"Tom text" }, 400);
  if (!voiceId) return json({ ok:false, error:"Ingen voiceId (skicka i body.voiceId eller sätt ELEVENLABS_VOICE_ID)" }, 400);

  // --- Cache-nyckel
  const keyBase = `${voiceId}::${speed}::${text}`;
  const key     = await sha1(keyBase) + ".mp3";

  // --- Försök cache HIT (R2)
  let hits = 0, total = 1;
  const head = await env.BN_AUDIO.head(key).catch(()=>null);
  if (head?.size) {
    const obj = await env.BN_AUDIO.get(key);
    if (obj) {
      hits = 1;
      return new Response(obj.body, {
        headers: {
          "content-type": "audio/mpeg",
          "cache-control": "public, max-age=31536000, immutable",
          "x-tts-cache": "HIT",
          "x-tts-hits": String(hits),
          "x-tts-total": String(total),
          "x-tts-key": key
        }
      });
    }
  }

  // --- MISS: hämta från ElevenLabs
  total = 1;
  const mp3 = await synthElevenLabs({ apiKey, voiceId, text, speed });
  if (!mp3) return json({ ok:false, error:"TTS misslyckades" }, 500);

  // --- Spara i R2
  try { await env.BN_AUDIO.put(key, mp3, { httpMetadata: { contentType:"audio/mpeg" } }); } catch {}

  return new Response(mp3, {
    headers: {
      "content-type": "audio/mpeg",
      "cache-control": "public, max-age=31536000, immutable",
      "x-tts-cache": "MISS",
      "x-tts-hits": String(hits),
      "x-tts-total": String(total),
      "x-tts-key": key
    }
  });
}

// --- Hjälpare

async function synthElevenLabs({ apiKey, voiceId, text, speed }) {
  // Använder v1 text-to-speech (multilingual v2). ElevenLabs accepterar "voice_settings".
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;
  const payload = {
    text,
    model_id: "eleven_multilingual_v2",
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.2,
      use_speaker_boost: true
    },
    // prosody-speed påverkas av SSML. Billig lösning: lägg SSML wrapper.
    // ElevenLabs tar SSML om man sätter "optimize_streaming_latency" eller "apply_text_normalization".
    // Vi kör enkel SSML här:
    // OBS: om text redan innehåller < > så escapas den.
  };

  // SSML wrapper för hastighet
  const safe = text
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const ssml = `<speak><prosody rate="${Math.round(speed*100)}%">${safe}</prosody></speak>`;

  const headers = {
    "xi-api-key": apiKey,
    "content-type": "application/json",
    "accept": "audio/mpeg"
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...payload, text: ssml })
  });

  if (!res.ok) {
    const msg = await res.text().catch(()=>res.statusText);
    // Skicka tillbaka vettigt fel
    throw new Error(`TTS 400: ${msg}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

async function sha1(s) {
  const enc = new TextEncoder();
  const data = enc.encode(s);
  const hashBuf = await crypto.subtle.digest("SHA-1", data);
  const bytes = new Uint8Array(hashBuf);
  return [...bytes].map(b=>b.toString(16).padStart(2,"0")).join("");
}

function json(obj, status=200, headers={}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", ...headers }
  });
}
