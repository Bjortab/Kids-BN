// functions/tts.js
// Stabil ElevenLabs TTS. Tar { text, voiceId? } och returnerar audio/mpeg.
// Kräver env.ELEVENLABS_API_KEY och ev. env.ELEVENLABS_VOICE_ID.

const ALLOWED_ORIGIN = (origin) => {
  try {
    const o = new URL(origin || "");
    return o.host.endsWith(".pages.dev") || o.host.endsWith("localhost") || o.host.includes("kids-bn.pages.dev");
  } catch { return false; }
};
const cors = (origin) => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN(origin) ? origin : "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
});

export async function onRequestOptions(ctx) {
  return new Response(null, { status: 204, headers: cors(ctx.request.headers.get("origin")) });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const origin = request.headers.get("origin");

  try {
    const { text = "", voiceId = "" } = await request.json().catch(()=> ({}));
    if (!text?.trim()) {
      return new Response(JSON.stringify({ error:"Tom text" }), { status: 400, headers: { ...cors(origin), "Content-Type":"application/json" } });
    }

    const apiKey  = env.ELEVENLABS_API_KEY;
    const voice   = voiceId || env.ELEVENLABS_VOICE_ID;
    if (!apiKey || !voice) {
      return new Response(JSON.stringify({ error:"Saknar ELEVENLABS_API_KEY eller röst-id" }),
        { status: 500, headers: { ...cors(origin), "Content-Type":"application/json" } });
    }

    // Vi ber tydligt om svenska (hjälper ibland prosodin lite)
    const body = JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.35, similarity_boost: 0.8 },
    });

    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
      },
      body
    });

    if (!ttsRes.ok) {
      const e = await ttsRes.text().catch(()=> "");
      return new Response(JSON.stringify({ error:`ElevenLabs: ${ttsRes.status} ${e}` }),
        { status: 502, headers: { ...cors(origin), "Content-Type":"application/json" } });
    }

    // Strömmar mp3 ut direkt
    return new Response(ttsRes.body, {
      status: 200,
      headers: {
        ...cors(origin),
        "Content-Type": "audio/mpeg"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error:String(err) }), {
      status: 500,
      headers: { ...cors(origin), "Content-Type":"application/json" }
    });
  }
}
