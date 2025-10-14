// functions/tts.js — v2.1 locked: sentence cache + short pause + story cache
// R2 binding: env.BN_AUDIOS (bucket: bn-audio)
// Secrets: ELEVENLABS_API_KEY, optional ELEVENLABS_VOICE_ID
// Returns audio/mpeg, with headers: X-TTS-Hits, X-TTS-Total, X-TTS-Level, X-TTS-Cache

const PROVIDER = { ELEVEN: "elevenlabs" };

const cors = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
});

export const onRequestOptions = async ({ env, request }) =>
  new Response(null, { status: 204, headers: cors(env?.BN_ALLOWED_ORIGIN || new URL(request.url).origin) });

export const onRequestGet = async ({ env, request }) =>
  new Response(JSON.stringify({ error: "Method Not Allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json", ...cors(env?.BN_ALLOWED_ORIGIN || new URL(request.url).origin) },
  });

// === utils ===
const te = new TextEncoder();
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", te.encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function normalizeText(t) { return (t || "").replace(/\s+/g, " ").trim(); }
function splitSentences(t) {
  const clean = t.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  return clean.split(/(?<=[.!?…])\s+/u).map(s => s.trim()).filter(Boolean).slice(0, 120);
}
function concatBytes(buffers) {
  const total = buffers.reduce((n, b) => n + b.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0; for (const b of buffers) { out.set(new Uint8Array(b), off); off += b.byteLength; }
  return out.buffer;
}

// === ElevenLabs call ===
async function elevenlabsTTS(env, text, voiceId) {
  const vid = voiceId || env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${vid}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
      },
      body: JSON.stringify({
        model_id: "eleven_multilingual_v2",
        text,
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.75,
          style: 0.15,
          use_speaker_boost: true
        }
      })
    }
  );
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text().catch(()=> "")}`);
  return await res.arrayBuffer();
}

// === silent clip (cached once) ===
async function getSilenceClip(env, ms = 200) {
  const key = `tts/silence/${ms}ms.mp3`;
  const r2 = env.BN_AUDIOS;
  const existing = await r2.get(key);
  if (existing) return await existing.arrayBuffer();

  // Minimal mp3 "tystnad" ~0.2s @ 44.1kHz mono (förkonstruerad, liten)
  const base64Silence = "SUQzAwAAAAAAF1RTU0MAAAAAAAABAAEARKwAABCxAgAEABAAZGF0YQAAAAA=";
  const bytes = Uint8Array.from(atob(base64Silence), c => c.charCodeAt(0)).buffer;
  await r2.put(key, bytes, {
    httpMetadata: { contentType: "audio/mpeg", cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { type: "silence", ms: String(ms) }
  });
  return bytes;
}

// === main ===
export const onRequestPost = async ({ env, request }) => {
  const origin = env?.BN_ALLOWED_ORIGIN || new URL(request.url).origin;
  try {
    const { text, voiceId } = await request.json();
    const t = normalizeText(text);
    if (!t) return new Response(JSON.stringify({ error: "Missing text" }), {
      status: 400, headers: { "Content-Type": "application/json", ...cors(origin) }
    });

    if (!env?.ELEVENLABS_API_KEY || !env?.BN_AUDIOS)
      return new Response(JSON.stringify({ error: "Missing env config" }), {
        status: 500, headers: { "Content-Type": "application/json", ...cors(origin) }
      });

    const r2 = env.BN_AUDIOS;

    // story-level hash
    const storyKey = await sha256Hex(`v2.1|story|${voiceId || ""}|${t}`);
    const storyObj = await r2.get(`tts/stories/${storyKey}.mp3`);
    if (storyObj) {
      return new Response(await storyObj.arrayBuffer(), {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "X-TTS-Cache": "HIT",
          "X-TTS-Level": "story",
          ...cors(origin)
        }
      });
    }

    // sentence-level
    const sents = splitSentences(t);
    const silence = await getSilenceClip(env);
    const chunks = [];
    let hit = 0;

    for (const s of sents) {
      const sid = await sha256Hex(`v2.1|sent|${voiceId || ""}|${normalizeText(s)}`);
      const path = `tts/sentences/${sid}.mp3`;
      const obj = await r2.get(path);
      if (obj) {
        hit++;
        chunks.push(await obj.arrayBuffer());
      } else {
        const ab = await elevenlabsTTS(env, s, voiceId);
        chunks.push(ab);
        await r2.put(path, ab, {
          httpMetadata: { contentType: "audio/mpeg", cacheControl: "public, max-age=31536000, immutable" },
          customMetadata: { provider: PROVIDER.ELEVEN }
        });
      }
      // kort paus mellan meningar
      chunks.push(silence);
    }

    const full = concatBytes(chunks);
    await r2.put(`tts/stories/${storyKey}.mp3`, full, {
      httpMetadata: { contentType: "audio/mpeg", cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: { provider: PROVIDER.ELEVEN, hits: String(hit), total: String(sents.length) }
    });

    return new Response(full, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "X-TTS-Level": "sentence",
        "X-TTS-Hits": String(hit),
        "X-TTS-Total": String(sents.length),
        "X-TTS-Cache": hit > 0 ? "PARTIAL" : "STORE",
        ...cors(origin)
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { "Content-Type": "application/json", ...cors(origin) }
    });
  }
};
