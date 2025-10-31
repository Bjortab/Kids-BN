// functions/tts.js
// Pages Function: POST /api/tts
// Enkel Google Text-to-Speech via API key (samma som tts_vertex)
// Kräver: env.GOOGLE_TTS_KEY eller env.GOOGLE_TTS_API_KEY
// Returnerar audio/mpeg och hanterar CORS preflight.

export async function onRequestOptions({ env }) {
  const origin = env.KIDSBN_ALLOWED_ORIGIN || '*';
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = env.KIDSBN_ALLOWED_ORIGIN || '*';

  try {
    const body = await request.json().catch(()=>({}));
    const text = (body?.text || '').trim();
    const voice = body?.voice || 'sv-SE-Wavenet-A';

    if (!text) return json({ error: 'Ingen text att läsa upp.' }, 400, origin);

    const key = env.GOOGLE_TTS_KEY || env.GOOGLE_TTS_API_KEY;
    if (!key) return json({ error: 'Serverkonfiguration saknar Google TTS key.' }, 500, origin);

    const reqBody = {
      input: { text },
      voice: { languageCode: 'sv-SE', name: voice },
      audioConfig: { audioEncoding: 'MP3' }
    };

    const resp = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody)
    });

    if (!resp.ok) {
      const t = await resp.text().catch(()=>'');
      return json({ error: 'Google TTS error', details: t }, 502, origin);
    }

    const ttsData = await resp.json().catch(()=>null);
    const audioContent = ttsData?.audioContent;
    if (!audioContent) return json({ error: 'Google TTS returned no audioContent' }, 502, origin);

    try {
      const binaryString = atob(audioContent);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
      return new Response(bytes.buffer, {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg', 'Access-Control-Allow-Origin': origin }
      });
    } catch (e) {
      return new Response(audioContent, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream', 'Access-Control-Allow-Origin': origin }
      });
    }
  } catch (err) {
    return json({ error: 'Serverfel', details: String(err?.message || err) }, 500, env.KIDSBN_ALLOWED_ORIGIN || '*');
  }
}

function json(obj, status = 200, origin = '*') {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin }
  });
}
