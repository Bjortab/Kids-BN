// functions/tts.js
export async function onRequestOptions(ctx) {
  return new Response(null, {
    status: 204,
    headers: cors(ctx.env)
  });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const baseHeaders = cors(env);

  try {
    const { text, voiceId } = await request.json();
    if (!text || !text.trim()) {
      return json({ error: "Tom text" }, 400, baseHeaders);
    }

    // 1) dela upp i meningar (lagom långa bitar)
    const parts = splitIntoSentences(text, 280);
    const total = parts.length;
    let hits = 0;

    const chunks = [];
    for (const s of parts) {
      const vId = voiceId || env.ELEVENLABS_VOICE_ID || "default";
      const key = `v2/${hashStable(`${vId}::${s}`)}.mp3`;

      let mp3Bytes = null;

      // 2) försök R2 cache
      if (env.BN_AUDIOS) {
        const obj = await env.BN_AUDIOS.get(key);
        if (obj) {
          hits++;
          mp3Bytes = new Uint8Array(await obj.arrayBuffer());
        }
      }

      // 3) annars ring ElevenLabs
      if (!mp3Bytes) {
        const xi = env.ELEVENLABS_API_KEY;
        const voice = vId;
        if (!xi || !voice) {
          return json({ error: "ELEVENLABS saknar API-nyckel eller voiceId." }, 500, baseHeaders);
        }

        const body = {
          text: s,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.8 },
          optimize_streaming_latency: 2
        };

        const el = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`,
          {
            method: "POST",
            headers: {
              "xi-api-key": xi,
              "Content-Type": "application/json",
              "Accept": "audio/mpeg"
            },
            body: JSON.stringify(body)
          }
        );

        if (!el.ok) {
          const t = await el.text().catch(() => "");
          return json({ error: `ElevenLabs: ${el.status} ${t}` }, 502, baseHeaders);
        }
        mp3Bytes = new Uint8Array(await el.arrayBuffer());

        // 4) spara i R2 (om finns)
        if (env.BN_AUDIOS) {
          await env.BN_AUDIOS.put(key, mp3Bytes, {
            httpMetadata: { contentType: "audio/mpeg" }
          });
        }
      }

      chunks.push(mp3Bytes);
    }

    const merged = concatUint8Arrays(chunks);
    const out = new Response(merged, {
      status: 200,
      headers: {
        ...baseHeaders,
        "content-type": "audio/mpeg",
        "x-tts-hits": String(hits),
        "x-tts-total": String(total)
      }
    });
    return out;
  } catch (err) {
    return json({ error: String(err?.message || err) }, 500, baseHeaders);
  }
}

/* ---------- helpers ---------- */
function cors(env) {
  return {
    "access-control-allow-origin": env.BN_ALLOWED_ORIGIN || "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization"
  };
}
function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}
function splitIntoSentences(text, maxLen = 280) {
  const raw = text.replace(/\r/g, "").split(/(?<=[\.\!\?])\s+/);
  const out = [];
  let buf = "";
  for (const part of raw) {
    if ((buf + " " + part).trim().length > maxLen && buf) {
      out.push(buf.trim());
      buf = part;
    } else {
      buf = (buf ? buf + " " : "") + part;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}
function hashStable(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ("00000000" + (h >>> 0).toString(16)).slice(-8);
}
function concatUint8Arrays(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
