// functions/tts.js  (GC v1.0 – låst)
// - ElevenLabs TTS med R2-cache per mening (stabilt läge)
// - Kräver R2-binding: BN_AUDIO  ->  ditt bucket-namn: bn-audio
// - Kräver secret: ELEVENLABS_API_KEY  (i Pages -> Settings -> Variables & Secrets)
// - Valfri voice override via request body: { voiceId: "..." }

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const headers = new Headers({
    "access-control-allow-origin": env.BN_ALLOWED_ORIGIN || "*",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-cache",
  });

  try {
    const body = await request.json().catch(() => ({}));
    const text = (body?.text || "").toString().trim();
    let voiceId = (body?.voiceId || "").toString().trim();

    if (!text) {
      return new Response(JSON.stringify({ ok: false, error: "No text" }), {
        status: 400, headers
      });
    }
    const apiKey = env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ ok: false, error: "Missing ELEVENLABS_API_KEY" }), {
        status: 500, headers
      });
    }

    // -------------- Röstval (stabilt) --------------
    // Om ingen voiceId skickas från klienten: använd din default från env eller en beprövad svensk röst
    // Tips: lägg din favorit i wrangler.toml:  ELEVENLABS_VOICE_ID="xxxxxxxx"
    if (!voiceId) voiceId = (env.ELEVENLABS_VOICE_ID || "").trim();
    if (!voiceId) {
      // fallback till en svensk röst (byt gärna till din)
      voiceId = "21m00Tcm4TlvDq8ikWAM"; // ex. "Rachel" – byt senare till din svenska röst-ID
    }

    // -------------- Splitta i meningar --------------
    const sentences = splitToSentences(text);
    const total = sentences.length;
    let hits = 0;

    // Skapa tom wav med concat av meningar från R2/Elevenlabs
    const chunks = [];
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i].trim();
      if (!s) continue;

      const key = cacheKey(voiceId, s);
      let mp3 = await getFromR2(env.BN_AUDIO, key);
      if (mp3) {
        hits++;
      } else {
        mp3 = await ttsElevenLabs(apiKey, voiceId, s);
        // lägg i R2 för återanvändning
        await putToR2(env.BN_AUDIO, key, mp3, "audio/mpeg");
      }
      chunks.push(new Uint8Array(await mp3.arrayBuffer()));
    }

    // Sätt cache-metern i headers (läser du i Network/Headers)
    headers.set("x-tts-hits", String(hits));
    headers.set("x-tts-total", String(total));
    headers.set("content-type", "audio/mpeg");

    // “Sy ihop” mp3-bitarna utan att röra själva innehållet (spelare hanterar separata ramar)
    const merged = concatUint8(chunks);
    return new Response(merged, { status: 200, headers });
  } catch (err) {
    headers.set("content-type", "application/json");
    return new Response(JSON.stringify({ ok: false, error: err?.message || String(err) }), {
      status: 500, headers
    });
  }
}

// ===== Hjälpare =====

function splitToSentences(text) {
  // snäll men robust meningsdelare
  // 1–2 år: många [BYT SIDA]-taggar -> ignorera dem för TTS
  const cleaned = text.replace(/\[BYT SIDA\]/gi, " ").replace(/\s+/g, " ").trim();
  // dela på . ! ? och svenska specialfall
  return cleaned.split(/(?<=[\.\!\?…])\s+/g).map(s => s.trim()).filter(Boolean);
}

function cacheKey(voiceId, sentence) {
  // enkel men stabil nyckel
  const enc = new TextEncoder().encode(`${voiceId}::${sentence}`);
  let hash = 0;
  for (let i = 0; i < enc.length; i++) hash = (hash * 31 + enc[i]) >>> 0;
  return `tts/v1/${voiceId}/${hash}.mp3`;
}

async function getFromR2(bucket, key) {
  try {
    const obj = await bucket.get(key);
    if (!obj) return null;
    return new Response(await obj.arrayBuffer(), {
      headers: { "content-type": obj.httpMetadata?.contentType || "application/octet-stream" }
    });
  } catch { return null; }
}

async function putToR2(bucket, key, res, contentType = "application/octet-stream") {
  const buf = await res.arrayBuffer();
  await bucket.put(key, buf, { httpMetadata: { contentType } });
}

async function ttsElevenLabs(apiKey, voiceId, text) {
  // Minimal, stabil TTS till mp3
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;
  const body = {
    text,
    model_id: "eleven_multilingual_v2",
    voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true }
  };
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
      "accept": "audio/mpeg"
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`TTS ${r.status} ${await r.text().catch(()=> "")}`);
  return r; // Response med mp3
}

function concatUint8(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}
