export async function onRequestOptions({ env }) {
  return new Response(null, { status: 204, headers: cors(env.KIDSBN_ALLOWED_ORIGIN || "*") });
}

export async function onRequestPost({ request, env }) {
  const allow = env.KIDSBN_ALLOWED_ORIGIN || "*";
  try {
    const { text, voice } = await request.json();
    if (!text || !text.trim()) return json({ error: "Missing text" }, 400, allow);
    if (!env.ELEVENLABS_API_KEY) return json({ error: "TTS disabled (no ELEVENLABS_API_KEY)" }, 501, allow);

    const id = crypto.randomUUID();
    const prefix = (env.AUDIO_PREFIX || "kids/tts").replace(/^\/+|\/+$/g, "");
    const key = `${prefix}/${id}.mp3`;

    const voiceId = voice || env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";
    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?optimize_streaming_latency=2`, {
      method: "POST",
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: text.slice(0, 5000), voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
    });
    if (!ttsRes.ok) {
      const t = await ttsRes.text().catch(()=> "");
      return json({ error: "TTS failed", details: t }, 502, allow);
    }

    await env["bn-audio"].put(key, ttsRes.body, { httpMetadata: { contentType: "audio/mpeg" } });
    return json({ id }, 200, allow);
  } catch (e) { return json({ error: e?.message || "Server error" }, 500, allow); }
}

export async function onRequestGet({ request, env }) {
  const allow = env.KIDSBN_ALLOWED_ORIGIN || "*";
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return new Response(JSON.stringify({ error: "Missing id" }), { status: 400, headers: cors(allow) });

    const prefix = (env.AUDIO_PREFIX || "kids/tts").replace(/^\/+|\/+$/g, "");
    const key = `${prefix}/${id}.mp3`;
    const obj = await env["bn-audio"].get(key);
    if (!obj) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: cors(allow) });

    return new Response(obj.body, { status: 200, headers: { "Content-Type":"audio/mpeg", "Cache-Control":"public, max-age=31536000, immutable", ...cors(allow) } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "Server error" }), { status: 500, headers: cors(allow) });
  }
}

function cors(origin){
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
function json(obj, status, origin){ return new Response(JSON.stringify(obj), { status, headers: { "Content-Type":"application/json", ...cors(origin) } }); }
