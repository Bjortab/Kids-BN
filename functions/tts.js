// functions/tts.js
// TTS med per-menings-cache i R2 (BN_AUDIOS). Returnerar audio/mpeg.
// Headers: x-tts-hits, x-tts-total (för din mätare i UI).

/** CORS **/
const ALLOWED_ORIGIN = (origin) => {
  try {
    const o = new URL(origin || "");
    return (
      o.host.endsWith(".pages.dev") ||
      o.host.includes("kids-bn.pages.dev") ||
      o.hostname === "localhost"
    );
  } catch { return false; }
};
const cors = (origin) => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN(origin) ? origin : "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
});

/** Små helpers **/
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
/** Delar svensk text till meningar */
function splitToSentences(text) {
  if (!text) return [];
  // Ersätt radbrytningar med punkt (för att få med korta rader)
  const t = text.replace(/\n+/g, ". ");
  // Dela på punkt, utrop, fråga, ellipsis – behåll tecken
  const parts = t.split(/(?<=[.!?…])\s+/).map(s => normalizeSentence(s));
  // Filtrera bort väldigt korta "meningar"
  return parts.filter(s => s && s.replace(/[.!?…]/g,"").trim().split(/\s+/).length >= 2);
}

/** Läser hela ReadableStream till ArrayBuffer */
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

export async function onRequestOptions(ctx) {
  return new Response(null, { status: 204, headers: cors(ctx.request.headers.get("origin")) });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const origin = request.headers.get("origin");

  try {
    const { text = "", voiceId = "", lang = env.LANG_DEFAULT || "sv" } =
      await request.json().catch(() => ({}));

    if (!text?.trim()) {
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

    const sentences = splitToSentences(text);
    if (!sentences.length) {
      return new Response(JSON.stringify({ error: "Kunde inte dela upp texten i meningar" }), {
        status: 400, headers: { ...cors(origin), "Content-Type": "application/json" }
      });
    }

    let hits = 0;
    const total = sentences.length;
    const mp3Buffers = [];

    for (const raw of sentences) {
      const s = normalizeSentence(raw);
      const hash = await sha1Hex(`${lang}|${voice}|${s}`);
      const key  = `tts/v2/${voice}/${lang}/${hash}.mp3`;

      // 1) Försök hämta från cache (R2)
      const cached = await env.BN_AUDIOS.get(key);
      if (cached) {
        hits++;
        mp3Buffers.push(await cached.arrayBuffer());
        continue;
      }

      // 2) Annars hämta från ElevenLabs (per mening)
      const body = JSON.stringify({
        text: s,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.35, similarity_boost: 0.8 },
      });

      const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        body,
      });

      if (!ttsRes.ok || !ttsRes.body) {
        const errTxt = await ttsRes.text().catch(() => "");
        return new Response(JSON.stringify({ error: `ElevenLabs: ${ttsRes.status} ${errTxt}` }), {
          status: 502, headers: { ...cors(origin), "Content-Type": "application/json" }
        });
      }

      const ab = await streamToArrayBuffer(ttsRes.body);
      mp3Buffers.push(ab);

      // 3) Spara i R2 för återanvändning
      await env.BN_AUDIOS.put(key, ab, {
        httpMetadata: { contentType: "audio/mpeg" }
      });
    }

    // Slå ihop alla MP3-bitar till en fil (binär konkatenation)
    const totalBytes = mp3Buffers.reduce((a, b) => a + b.byteLength, 0);
    const out = new Uint8Array(totalBytes);
    let offset = 0;
    for (const ab of mp3Buffers) {
      out.set(new Uint8Array(ab), offset);
      offset += ab.byteLength;
    }

    return new Response(out, {
      status: 200,
      headers: {
        ...cors(origin),
        "Content-Type": "audio/mpeg",
        "x-tts-hits": String(hits),
        "x-tts-total": String(total),
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...cors(origin), "Content-Type": "application/json" }
    });
  }
}
