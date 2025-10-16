// /functions/tts_diag.js
export async function onRequest({ env }) {
  const res = {
    model: env.ELEVENLABS_MODEL || "eleven_turbo_v2",
    has_api_key: !!env.ELEVENLABS_API_KEY,
    voice_id_present: !!env.ELEVENLABS_VOICE_ID,
    defaults: {
      stability: env.ELEVENLABS_STABILITY || "(unset, default 0.25)",
      similarity: env.ELEVENLABS_SIMILARITY || "(unset, default 0.85)",
      style: env.ELEVENLABS_STYLE || "(unset, default 0.35)",
      speaker_boost: env.ELEVENLABS_SPEAKER_BOOST || "(unset, default true)"
    }
  };
  return new Response(JSON.stringify(res, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
