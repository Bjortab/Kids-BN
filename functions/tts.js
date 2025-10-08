export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const allow = env.KIDSBN_ALLOWED_ORIGIN || origin;

  const bad = (code, msg) => new Response(msg, {
    status: code,
    headers: {
      'Access-Control-Allow-Origin': allow,
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });

  try {
    const { text, childName, age } = await request.json();
    if (!env.ELEVENLABS_API_KEY) return bad(500, 'ELEVENLABS_API_KEY saknas');
    const voiceId = env.ELEVENLABS_VOICE_ID || env.DEFAULT_VOICE_ID;
    if (!voiceId) return bad(500, 'ELEVENLABS_VOICE_ID saknas');

    if (!text || !text.trim()) return bad(400, 'Tom text');

    // Generera TTS via ElevenLabs
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        voice_settings: { stability: 0.55, similarity_boost: 0.75 },
        model_id: 'eleven_multilingual_v2',
        output_format: 'mp3_44100_128'
      })
    });

    if (!r.ok) {
      const t = await r.text();
      return bad(500, `ElevenLabs fel: ${t}`);
    }

    const mp3 = await r.arrayBuffer();

    // Spara i R2
    const id = `${(childName || 'barn')}-${Date.now()}.mp3`;
    const key = `${env.AUDIO_PREFIX || 'kids/tts'}/${id}`;
    await env.BN_AUDIO_BUCKET.put(key, mp3, {
      httpMetadata: { contentType: 'audio/mpeg', cacheControl: 'public,max-age=31536000,immutable' }
    });

    return new Response(JSON.stringify({ id, url: `/tts?id=${encodeURIComponent(id)}` }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': allow,
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  } catch (err) {
    return bad(500, `TTS error: ${err.message}`);
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const key = `${env.AUDIO_PREFIX || 'kids/tts'}/${id}`;
  const obj = await env.BN_AUDIO_BUCKET.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, {
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control':'public, max-age=31536000, immutable' }
  });
}

export async function onRequestOptions(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '*';
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': env.KIDSBN_ALLOWED_ORIGIN || origin,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
    }
  });
}
