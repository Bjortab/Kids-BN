// functions/_shared/r2_index.js
// Enkel index i R2 som JSON per (lang/model/voice)
// Fil: tts-index/{lang}/{model}/{voiceId}.json => { keys: [ "encodedSafeText", ... ] }

export async function readIndex(env, lang, model, voiceId) {
  const key = `tts-index/${lang}/${model}/${voiceId}.json`;
  const obj = await env.BN_AUDIOS.get(key);
  if (!obj) return { key, keys: [] };
  try {
    const json = await obj.json();
    return { key, keys: Array.isArray(json.keys) ? json.keys : [] };
  } catch {
    return { key, keys: [] };
  }
}

export async function writeIndex(env, indexKey, keys) {
  const body = JSON.stringify({ keys: Array.from(new Set(keys)).slice(-2000) });
  await env.BN_AUDIOS.put(indexKey, body, {
    httpMetadata: { contentType: "application/json" }
  });
}
