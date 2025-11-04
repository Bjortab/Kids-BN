// functions/api/whisper.js
// Pages Function: transkriberar en ljudfil via OpenAI Whisper (eller liknande).
// - Stödjer preflight OPTIONS (CORS).
// - Accept: multipart/form-data (fält "file") eller JSON { audioBase64, audioContentType }.
// - Kräver env.OPENAI_API_KEY och (valfritt) env.WHISPER_MODEL.
// - Returnerar JSON: { ok: true, transcript: "...", raw: <upstream-json> }

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('origin') || env.BN_ALLOWED_ORIGIN || '*';

  const CORS_HEADERS = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json;charset=utf-8"
  };

  try {
    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ ok: false, error: 'Method not allowed. Use POST.' }), { status: 405, headers: CORS_HEADERS });
    }

    // Kontrollera att vi har en OpenAI key (eller annan upstream)
    const OPENAI_KEY = env.OPENAI_API_KEY;
    if (!OPENAI_KEY) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing OPENAI_API_KEY in environment' }), { status: 500, headers: CORS_HEADERS });
    }
    const WHISPER_MODEL = env.WHISPER_MODEL || 'whisper-1';

    // Försök läsa multipart/form-data först
    let file = null;
    let filename = 'recording.webm';
    let contentType = 'audio/webm';

    const contentTypeHeader = (request.headers.get('content-type') || '').toLowerCase();

    if (contentTypeHeader.includes('multipart/form-data')) {
      // form-data upload (standard)
      const form = await request.formData();
      file = form.get('file') || form.get('audio') || null;
      if (file && file.name) filename = file.name;
      if (file && file.type) contentType = file.type;
    } else {
      // alternativ: JSON med base64
      try {
        const body = await request.json().catch(() => null);
        if (body && body.audioBase64) {
          const b64 = String(body.audioBase64).split(',').pop();
          const raw = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
          const len = raw.length;
          const u8 = new Uint8Array(len);
          for (let i = 0; i < len; i++) u8[i] = raw.charCodeAt(i);
          const blob = new Blob([u8.buffer], { type: body.audioContentType || 'audio/webm' });
          file = blob;
          filename = `recording.${(body.audioContentType || 'audio/webm').split('/')[1] || 'webm'}`;
          contentType = body.audioContentType || 'audio/webm';
        }
      } catch (e) {
        // ignore, handled below
      }
    }

    if (!file) {
      return new Response(JSON.stringify({ ok: false, error: 'No audio file found in request (multipart "file" or JSON audioBase64).' }), { status: 400, headers: CORS_HEADERS });
    }

    // Forward to OpenAI Whisper transcription endpoint
    // Build a FormData to send to OpenAI
    const forwardForm = new FormData();
    // Append file (Workers supports appending File/Blob)
    try {
      // If file is a File-like object from formData (Workers File), append directly.
      forwardForm.append('file', file, filename);
    } catch (e) {
      // Fallback: if append with name fails, try without filename
      forwardForm.append('file', file);
    }
    forwardForm.append('model', WHISPER_MODEL);
    // Optionally: forward language if you want
    // forwardForm.append('language', 'sv');

    const upstreamRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`
        // Note: do NOT set Content-Type header when sending FormData — fetch sets it including boundary.
      },
      body: forwardForm
    });

    const status = upstreamRes.status;
    const text = await upstreamRes.text().catch(() => '');

    // Om upstream returnerar JSON
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch(e){ parsed = null; }

    if (!upstreamRes.ok) {
      return new Response(JSON.stringify({ ok: false, error: 'Upstream transcription failed', status, body: parsed || text }), { status: 502, headers: CORS_HEADERS });
    }

    // OpenAI Whisper returns { text: "..." } — normalisera
    const transcript = (parsed && (parsed.text || parsed.transcript || parsed?.result?.text)) || (typeof text === 'string' ? text : '');

    return new Response(JSON.stringify({ ok: true, transcript: String(transcript || '').trim(), raw: parsed || text }), { status: 200, headers: CORS_HEADERS });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: CORS_HEADERS });
  }
}
