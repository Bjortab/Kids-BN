// functions/tts.js
// Pages Function: POST /tts  -> returnerar MP3 + cache-headrar
// Kräver bindings: BN_AUDIOS (R2), ELEVENLABS_API_KEY (secret)
// Valfri default: ELEVENLABS_VOICE_ID i wrangler/Pages Settings.
// Voice kan override: { voiceId } i body.

import { normalizeText, similarity, makeCacheKey } from "./_shared/text_utils.js";
import { readIndex, writeIndex } from "./_shared/r2_index.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    const { text, voiceId: voiceOverride, model, lang } = await request.json();

    const lang2  = (lang || env.LANG_DEFAULT || "sv").toLowerCase();
    const model2 = (model || "elevenlabs-v1");
    const voiceId = (voiceOverride || env.ELEVENLABS_VOICE_ID || "").trim();

    if (!text || !voiceId) {
      return new Response(JSON.stringify({ ok:false, error:"Saknar text eller voiceId" }), { status: 400 });
    }

    // Normalisera & gör cachekey
    const norm = normalizeText(text);
    const r2Key = makeCacheKey(norm, voiceId, model2, lang2); // tts/sv/model/voice/encoded.mp3

    // 1) EXAKT TRÄFF?
    const hitExact = await env.BN_AUDIOS.head(r2Key);
    if (hitExact) {
      const stream = await env.BN_AUDIOS.get(r2Key);
      return okAudio(stream, {
        "X-Tts-Cache": "HIT",
        "X-Tts-Key": r2Key
      });
    }

    // 2) FUZZY MOT INDEX
    const idx = await readIndex(env, lang2, model2, voiceId);
    let best = null;
    for (const safe of idx.keys) {
      const existingNorm = decodeURIComponent(safe);
      const sim = similarity(norm, existingNorm);
      if (!best || sim > best.sim) best = { safe, sim };
    }
    const THRESHOLD = 0.85;
    if (best && best.sim >= THRESHOLD) {
      const fuzzyKey = `tts/${lang2}/${model2}/${voiceId}/${best.safe}.mp3`;
      const exists = await env.BN_AUDIOS.head(fuzzyKey);
      if (exists) {
        const stream = await env.BN_AUDIOS.get(fuzzyKey);
        return okAudio(stream, {
          "X-Tts-Cache": `HIT_FUZZY_${Math.round(best.sim*100)}%`,
          "X-Tts-Key": fuzzyKey
        });
      }
    }

    // 3) GENERERA NYTT TTS (ElevenLabs)
    const apiKey = env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ ok:false, error:"Saknar ELEVENLABS_API_KEY" }), { status: 500 });
    }

    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
        "accept": "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.4, similarity_boost: 0.7, style: 0.0, use_speaker_boost: true }
      })
    });

    if (!ttsRes.ok) {
      const errTxt = await ttsRes.text().catch(()=> "");
      return new Response(JSON.stringify({ ok:false, error:`ElevenLabs: ${ttsRes.status} ${errTxt}` }), { status: 502 });
    }

    const arr = new Uint8Array(await ttsRes.arrayBuffer());
    await env.BN_AUDIOS.put(r2Key, arr, { httpMetadata: { contentType: "audio/mpeg" } });

    // uppdatera index
    const safe = encodeURIComponent(norm).slice(0,200);
    const newKeys = Array.from(new Set([ ...(idx.keys||[]), safe ]));
    await writeIndex(env, idx.key, newKeys);

    // returnera nyfilen
    const stream = await env.BN_AUDIOS.get(r2Key);
    return okAudio(stream, {
      "X-Tts-Cache": "MISS",
      "X-Tts-Key": r2Key
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok:false, error: String(err && err.message || err) }), { status: 500 });
  }
};

function okAudio(r2Object, extraHeaders = {}) {
  if (!r2Object) return new Response("Not found", { status:404 });
  const headers = new Headers({
    "content-type": "audio/mpeg",
    "cache-control": "no-cache",
    ...extraHeaders
  });
  return new Response(r2Object.body, { status:200, headers });
}
