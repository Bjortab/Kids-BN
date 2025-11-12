// functions/api/tts.js
// === GC v1.0 (backup-baserad, minimal ändring) ===
// Enkel Google TTS via REST. Ingen R2/cache – direkt binär MP3-ut.
// Läser både GOOGLE_TTS_API_KEY och GOOGLE_TTS_KEY (alias).
// CORS med konfigurerbart origin. Returnerar audio/mpeg.

export async function onRequest(context) {
  const { request, env } = context;
  const origin = env.KIDSBN_ALLOWED_ORIGIN || '*';
  const CORS = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  };

  function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  if (request.method !== 'POST' && request.method !== 'GET') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    // --- Läs text + voice från json/form/plain/query (som i din backup) ---
    const ct = (request.headers.get('content-type') || '').toLowerCase();
    let text = '';
    let voiceReq = '';
    let parsed = {};

    if (ct.includes('application/json')) {
      parsed = await request.json().catch(() => ({}));
      text = parsed?.text || parsed?.message || '';
      voiceReq = parsed?.voice || '';
    } else if (ct.includes('text/plain')) {
      text = await request.text().catch(() => '');
    } else if (ct.includes('application/x-www-form-urlencoded')) {
      const fd = await request.formData().catch(() => null);
      if (fd) {
        text = fd.get('text') || fd.get('message') || '';
        voiceReq = fd.get('voice') || '';
      }
    } else {
      try {
        const u = new URL(request.url);
        text = u.searchParams.get('text') || u.searchParams.get('message') || '';
        voiceReq = u.searchParams.get('voice') || '';
      } catch {}
    }

    text = (text || '').toString().trim();
    if (!text) return json({ ok: false, error: 'Missing text' }, 400);

    // --- Voice + API-nyckel ---
    const defaultVoice = env.GOOGLE_TTS_VOICE || 'sv-SE-Wavenet-A';
    const voice = (voiceReq || defaultVoice).toString();

    // VIKTIGT: läs båda varianterna, din miljö använder troligen GOOGLE_TTS_API_KEY
    const key = (env.GOOGLE_TTS_API_KEY || env.GOOGLE_TTS_KEY || '').toString().trim();
    if (!key) return json({ ok: false, error: 'Ingen Google TTS-nyckel (GOOGLE_TTS_API_KEY/GOOGLE_TTS_KEY)' }, 500);

    // Härled languageCode från voice (typ "sv-SE-Wavenet-A" -> "sv-SE")
    const lang = (() => {
      const p = voice.split('-');
      return (p.length >= 2 && p[0].length === 2 && p[1].length === 2) ? `${p[0]}-${p[1]}` : 'sv-SE';
    })();

    // --- Bygg request till Google ---
    const body = {
      input: { text },
      voice: { languageCode: lang, name: voice },
      audioConfig: { audioEncoding: 'MP3' }
    };

    const resp = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const errTxt = await resp.text().catch(() => '(no body)');
      return json({ ok: false, error: 'google TTS error', status: resp.status, details: errTxt.slice(0, 800) }, 502);
    }

    const data = await resp.json().catch(() => null);
    const b64 = data?.audioContent || '';
    if (!b64) return json({ ok: false, error: 'google TTS returned no audioContent' }, 502);

    // --- Base64 -> ArrayBuffer (som i din backup) ---
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);

    // Svara som MP3
    return new Response(bytes, {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'audio/mpeg' }
    });

  } catch (err) {
    return json({ ok: false, error: 'serverfel', details: String(err) }, 500);
  }
}
