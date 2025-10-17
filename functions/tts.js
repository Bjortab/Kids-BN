// functions/tts.js
// 🔊 ElevenLabs TTS med per-menings-cache i R2 (BN_AUDIOS).
// Returnerar audio/mpeg och headers: x-tts-hits / x-tts-total.

const ALLOWED_ORIGIN = (origin) => {
  try {
    const o = new URL(origin || "");
    return (
      o.host.endsWith(".pages.dev") ||
      o.hostname === "localhost" ||
      o.host.includes("bn") ||
      o.host.includes("kids-bn")
    );
  } catch { return false; }
};

const cors = (origin) => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN(origin) ? origin : "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
});

// === Hjälpfunktioner ===
const enc = new TextEncoder();

async function sha1Hex(str) {
  const buf = await crypto.subtle.digest("SHA-1", enc.encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,"0")).join("");
}

function normalizeSentence(s) {
  return (s || "")
    .replace(/\s+/g, " ")
    .replace(/\s([,.!?…])/g, "$1")
    .trim();
}

function splitToSentences(text) {
  if (!text) return [];
  const t = text.replace(/\n+/g, ". ");
  const parts = t.split(/(?<=[.!?…])\s+/).map(s => normalizeSentence(s));
  return parts.filter(s => s && s.replace(/[.!?…]/g,"").trim().split(/\s+/).length >= 2);
}

async function streamToArrayBuffer(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}

// === Huvudfunktioner ===
export async function onRequestOptions(ctx) {
  return new Response(null, { status: 204, headers: cors(ctx.request.headers.get("origin")) });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const origin = request.headers.get("origin");
  try {
    const { text = "", voiceId = "", lang = "sv" } = await request.json().catch(() => ({}));

    if (!text.trim()) {
      return new Response(JSON.stringify({ error: "Tom text" }), {
        status: 400, headers: { ...cors(origin), "Content-Type": "application/json" }
      });
    }

    const apiKey = env.ELEVENLABS_API_KEY;
    const voice  = voiceId || env.ELEVENLABS_VOICE_ID;
    if (!apiKey || !voice) {
      return new Response(JSON.stringify({ error: "Saknar ELEVENLABS_API_KEY eller ELEVENLABS_VOICE_ID" }), {
        status: 500, headers: { ...cors(origin), "Content-Type": "application/json" }
      });
    }
    if (!env.BN_AUDIOS) {
      return new Response(JSON.stringify({ error: "R2-binding BN_AUDIOS saknas" }), {
        status: 500, headers: { ...cors(origin), "Content-Type": "application/json" }
      });
    }

    // --- Dela upp i meningar och cachea ---
    const sentences = splitToSentences(text);
    if (!sentences.length) throw new Error("Kunde inte dela upp texten i meningar.");

    let hits = 0;
    const total = sentences.length;
    const mp3Buffers = [];

    for (const raw of sentences) {
      const s = normalizeSentence(raw);
      const hash = await sha1Hex(`${lang}|${voice}|${s}`);
      const key  = `tts/v2/${voice}/${lang}/${hash}.mp3`;

      // 1) Försök hämta från R2
      const cached = await env.BN_AUDIOS.get(key);
      if (cached) {
        hits++;
        mp3Buffers.push(await cached.arrayBuffer());
        continue;
      }

      // 2) Annars generera nytt ljud hos ElevenLabs
      const body = JSON.stringify({
        text: s,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.35, similarity_boost: 0.8 }
      });

      const ttsRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream`,
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json"
          },
          body
        }
      );

      if (!ttsRes.ok || !ttsRes.body) {
        throw new Error(`TTS misslyckades: ${ttsRes.status}`);
      }

      const arrBuf = await streamToArrayBuffer(ttsRes.body);
      mp3Buffers.push(arrBuf);

      // Cachea till R2
      await env.BN_AUDIOS.put(key, new Blob([arrBuf], { type: "audio/mpeg" }));
    }

    // Slå ihop allt ljud
    const finalBlob = new Blob(mp3Buffers, { type: "audio/mpeg" });
    return new Response(finalBlob, {
      status: 200,
      headers: {
        ...cors(origin),
        "Content-Type": "audio/mpeg",
        "x-tts-hits": String(hits),
        "x-tts-total": String(total)
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...cors(origin), "Content-Type": "application/json" }
    });
  }
}
