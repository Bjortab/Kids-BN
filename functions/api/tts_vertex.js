// functions/tts_vertex.js
// Pages Function: POST /api/tts_vertex
// Endast Google Text-to-Speech via API key (ingen google-auth-library).
// Samma beteende som functions/tts.js men separerad för rutt /api/tts_vertex.
// Kräver env.GOOGLE_TTS_KEY eller env.GOOGLE_TTS_API_KEY

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

export async function onRequestPost({ request, env }) {
  const origin = env.KIDSBN_ALLOWED_ORIGIN || '*';
  try {
    const ct = (request.headers.get('content-type') || '').toLowerCase();
    let text = '';

    if (ct.includes('application/json')) {
      const body = await request.json().catch(()=>null);
      text = body?.text || body?.message || '';
    } else if (ct.includes('text/plain')) {
      text = await request.text().catch(()=> '');
    } else if (ct.includes('form-data') || ct.includes('multipart/form-data') || ct.includes('application/x-www-form-urlencoded')) {
      const form = await request.formData().catch(()=>null);
      if (form) text = form.get('text') || form.get('message') || '';
    } else {
      try { const u = new URL(request.url); text = u.searchParams.get('text') || ''; } catch(e){}
    }

    text = (text || '').toString().trim();
    if (!text) return json({ error: 'Ingen text att läsa upp.' }, 400, origin);

    const voice = 'sv-SE-Wavenet-A';
    const key = env.GOOGLE_TTS_KEY || env.GOOGLE_TTS_API_KEY;
    if (!key) return json({ error: 'Ingen Google TTS nyckel konfigurerad (GOOGLE_TTS_KEY).' }, 500, origin);

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
    return json({ error: 'Serverfel', details: String(err?.message || err) }, 500, origin);
  }
}

function json(obj, status = 200, origin = '*') {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin }
  });
}
