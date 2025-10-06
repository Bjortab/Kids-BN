export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  const headers = {
    "Access-Control-Allow-Origin": env.KIDSBN_ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  if (method === "OPTIONS") return new Response(null, { status: 204, headers });

  const r2 = env["bn-audio"] || env.R2;
  if (!r2) return new Response("NO_R2_BINDING", { status: 500, headers });

  async function sha256Hex(str) {
    const data = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest("SHA-256", data);
    const arr = Array.from(new Uint8Array(buf));
    return arr.map(b => b.toString(16).padStart(2, "0")).join("");
  }

  if (method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) return new Response("Missing id", { status: 400, headers });
    const object = await r2.get(`${id}.mp3`);
    if (!object) return new Response("Not found", { status: 404, headers });

    const respHeaders = new Headers(headers);
    respHeaders.set("Content-Type", "audio/mpeg");
    respHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
    respHeaders.set("Content-Disposition", `attachment; filename="kidsbn-${id}.mp3"`);
    return new Response(object.body, { status: 200, headers: respHeaders });
  }

  if (method === "POST") {
    let body; try { body = await request.json(); } catch { return new Response(JSON.stringify({ error:"BAD_JSON" }), { status:400, headers }); }
    const text = (body?.text || "").toString().trim();
    const voice = (body?.voice || "kids_friendly").toString().trim();
    if (!text) return new Response(JSON.stringify({ error: "EMPTY_TEXT" }), { status: 400, headers });
    if (text.length > 4000) return new Response(JSON.stringify({ error: "TEXT_TOO_LONG" }), { status: 400, headers });

    const id = await sha256Hex(`${voice}|${text}`);
    const key = `${id}.mp3`;
    const head = await env["bn-audio"].head(key);
    if (head) return new Response(JSON.stringify({ id }), { status: 200, headers });

    const elevenKey = env.ELEVENLABS_API_KEY;
    if (!elevenKey) return new Response(JSON.stringify({ error: "NO_TTS_PROVIDER" }), { status: 501, headers });

    const VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
    const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;
    const payload = { text, model_id:"eleven_multilingual_v2", voice_settings:{ stability:0.5, similarity_boost:0.7, style:0.3, use_speaker_boost:true } };

    let audioArrayBuffer;
    try {
      const ttsRes = await fetch(endpoint, {
        method:"POST",
        headers:{ "xi-api-key": elevenKey, "Content-Type":"application/json", "Accept":"audio/mpeg" },
        body: JSON.stringify(payload)
      });
      if (!ttsRes.ok){ const errTxt=await ttsRes.text().catch(()=>"(no details)"); return new Response(JSON.stringify({ error:"TTS_UPSTREAM", detail:errTxt }), { status:502, headers }); }
      audioArrayBuffer = await ttsRes.arrayBuffer();
    } catch (e) {
      return new Response(JSON.stringify({ error:"TTS_FETCH_FAIL", detail:String(e||"") }), { status:502, headers });
    }

    try {
      await env["bn-audio"].put(key, audioArrayBuffer, { httpMetadata:{ contentType:"audio/mpeg", cacheControl:"public, max-age=31536000, immutable" } });
    } catch (e) {
      return new Response(JSON.stringify({ error:"R2_PUT_FAIL", detail:String(e||"") }), { status:500, headers });
    }

    return new Response(JSON.stringify({ id }), { status: 200, headers });
  }

  return new Response("Method Not Allowed", { status: 405, headers });
}
