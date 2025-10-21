// functions/tts.js
export const config = { path: "/tts" };

export async function onRequestPost(context) {
  const { request, env } = context;

  // ---- Bindings & secrets
  if (!env.BN_AUDIO) {
    return j({ ok:false, error:"R2 binding BN_AUDIO saknas" }, 500);
  }
  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return j({ ok:false, error:"ELEVENLABS_API_KEY saknas" }, 500);
  }

  // ---- Body
  let body = {};
  try { body = await request.json(); } catch {}
  const textRaw = (body?.text || "").trim();
  const speed   = Number.isFinite(+body?.speed) ? Math.max(0.5, Math.min(2, +body.speed)) : 1.0;
  const voiceId = (body?.voiceId || env.ELEVENLABS_VOICE_ID || "").trim();

  if (!textRaw) return j({ ok:false, error:"Tom text" }, 400);
  if (!voiceId) return j({ ok:false, error:"Ingen voiceId (skicka i body.voiceId eller sätt ELEVENLABS_VOICE_ID)" }, 400);

  // ---- Cache-key
  const keyBase = `${voiceId}::${speed}::${textRaw}`;
  const key     = await sha1(keyBase) + ".mp3";

  // ---- R2: HIT?
  try {
    const head = await env.BN_AUDIO.head(key);
    if (head?.size) {
      const obj = await env.BN_AUDIO.get(key);
      if (obj) {
        return new Response(obj.body, {
          headers: hAudio({ cache:"HIT", key, hits:1, total:1 })
        });
      }
    }
  } catch (e) {
    // Fortsätt – vi kan alltid generera nytt
  }

  // ---- MISS: ElevenLabs
  try {
    const mp3 = await synthElevenLabs({ apiKey, voiceId, text:textRaw, speed });
    // spara i R2 (best-effort)
    try { await env.BN_AUDIO.put(key, mp3, { httpMetadata: { contentType:"audio/mpeg" } }); } catch {}
    return new Response(mp3, { headers: hAudio({ cache:"MISS", key, hits:0, total:1 }) });
  } catch (err) {
    // Tydligt JSON-fel istället för HTML
    return j({ ok:false, error:String(err?.message || err) }, 500);
  }
}

// ---- ElevenLabs helper med fallback (SSML -> plaintext)
async function synthElevenLabs({ apiKey, voiceId, text, speed }) {
  const endpoint = (id) => `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(id)}`;
  const headers  = { "xi-api-key": apiKey, "content-type":"application/json", "accept":"audio/mpeg" };

  // SSML variant (för hastighet)
  const safe = text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const ssml = `<speak><prosody rate="${Math.round(speed*100)}%">${safe}</prosody></speak>`;

  // 1) Försök SSML
  let res = await fetch(endpoint(voiceId), {
    method:"POST",
    headers,
    body: JSON.stringify({
      text: ssml,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability:0.5, similarity_boost:0.75, style:0.2, use_speaker_boost:true }
    })
  });

  // 2) Om inte OK, försök vanlig text (fallback)
  if (!res.ok) {
    // Läs feltext (utan att krascha)
    const err1 = await res.text().catch(()=>res.statusText);
    res = await fetch(endpoint(voiceId), {
      method:"POST",
      headers,
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability:0.5, similarity_boost:0.75, style:0.2, use_speaker_boost:true }
      })
    });
    if (!res.ok) {
      const err2 = await res.text().catch(()=>res.statusText);
      throw new Error(`ElevenLabs fail: ${res.status}. SSML:${truncate(err1)} | Plain:${truncate(err2)}`);
    }
  }

  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

// ---- Utils
function j(obj, status=200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type":"application/json; charset=utf-8" }
  });
}
function hAudio({ cache, key, hits=0, total=1 }) {
  return {
    "content-type": "audio/mpeg",
    "cache-control": "public, max-age=31536000, immutable",
    "x-tts-cache": cache,
    "x-tts-key": key,
    "x-tts-hits": String(hits),
    "x-tts-total": String(total)
  };
}
async function sha1(s) {
  const data = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-1", data);
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function truncate(s, n=180) { if (!s) return ""; s = String(s); return s.length>n ? s.slice(0,n)+"…" : s; }
