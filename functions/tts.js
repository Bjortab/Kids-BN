// functions/tts.js
// Pages Function: POST /api/tts
// Tar emot JSON: { text: "...", voice: "sv-SE-Wavenet-A" }
// Använder env.GOOGLE_TTS_KEY (sätt i Pages → Settings → Variables & Secrets)
// Returnerar audio/mpeg (MP3) som binär data. Hanterar CORS preflight.

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
    // Läs inkommande JSON
    const body = await request.json().catch(() => null);
    const text = body?.text || '';
    const voice = body?.voice || 'sv-SE-Wavenet-A';

    if (!text || !text.trim()) {
      return json({ error: 'Ingen text att läsa upp.' }, 400, origin);
    }

    // Kontrollera att nyckel finns
    if (!env.GOOGLE_TTS_KEY && !env.GOOGLE_TTS_API_KEY && !env.GOOGLE_SA_JSON) {
      return json({ error: 'Serverkonfiguration saknar Google TTS key.' }, 500, origin);
    }

    // Anropa Google Text-to-Speech (REST v1 text:synthesize) med API key
    // If you instead use service account / OAuth, you should use a different flow (vertex/service account).
    const key = env.GOOGLE_TTS_KEY || env.GOOGLE_TTS_API_KEY;

    const reqBody = {
      input: { text },
      voice: { languageCode: 'sv-SE', name: voice },
      audioConfig: { audioEncoding: 'MP3' }
    };

    const resp = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody)
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      return json({ error: 'Google TTS error', details: t }, 502, origin);
    }

    const ttsData = await resp.json().catch(() => null);
    const audioContent = ttsData?.audioContent;
    if (!audioContent) {
      return json({ error: 'Google TTS returnerade inget audioContent' }, 502, origin);
    }

    // audioContent är base64-string. Dekoda till binär och returnera som MP3
    try {
      // atob fungerar i Cloudflare Pages/Workers
      const binaryString = atob(audioContent);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);

      return new Response(bytes.buffer, {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Access-Control-Allow-Origin': origin
        }
      });
    } catch (e) {
      // Fallback: returnera base64 som text om dekodning inte fungerar
      return new Response(audioContent, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Access-Control-Allow-Origin': origin
        }
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
