// functions/api/whisper.js
// Transkriberar ljud via OpenAI Whisper (multipart/form-data 'file' eller JSON audioBase64).
// Hanterar OPTIONS preflight och returnerar { ok:true, transcript }

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('origin') || env.BN_ALLOWED_ORIGIN || '*';
  const CORS_HEADERS = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Content-Type": "application/json;charset=utf-8" };

  try {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== 'POST') return new Response(JSON.stringify({ ok:false, error:'Method not allowed. Use POST.' }), { status:405, headers: CORS_HEADERS });

    const OPENAI_KEY = env.OPENAI_API_KEY;
    if (!OPENAI_KEY) return new Response(JSON.stringify({ ok:false, error:'Missing OPENAI_API_KEY' }), { status:500, headers: CORS_HEADERS });

    let file = null, filename = 'recording.webm', contentType = 'audio/webm';
    const ct = (request.headers.get('content-type') || '').toLowerCase();

    if (ct.includes('multipart/form-data')) {
      const form = await request.formData();
      file = form.get('file') || form.get('audio') || null;
      if (file && file.name) filename = file.name;
      if (file && file.type) contentType = file.type;
    } else {
      const body = await request.json().catch(()=>null);
      if (body && body.audioBase64) {
        const b64 = String(body.audioBase64).split(',').pop();
        const raw = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
        const len = raw.length;
        const u8 = new Uint8Array(len);
        for (let i=0;i<len;i++) u8[i] = raw.charCodeAt(i);
        file = new Blob([u8.buffer], { type: body.audioContentType || 'audio/webm' });
        filename = `recording.${(body.audioContentType || 'audio/webm').split('/')[1] || 'webm'}`;
        contentType = body.audioContentType || 'audio/webm';
      }
    }

    if (!file) return new Response(JSON.stringify({ ok:false, error:'No audio file found in request' }), { status:400, headers: CORS_HEADERS });

    const forwardForm = new FormData();
    try { forwardForm.append('file', file, filename); } catch(e){ forwardForm.append('file', file); }
    forwardForm.append('model', env.WHISPER_MODEL || 'whisper-1');

    const upstreamRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      body: forwardForm
    });

    const text = await upstreamRes.text().catch(()=>'');
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch(e){ parsed = null; }

    if (!upstreamRes.ok) return new Response(JSON.stringify({ ok:false, error:'Upstream transcription failed', status: upstreamRes.status, body: parsed || text }), { status:502, headers: CORS_HEADERS });

    const transcript = (parsed && (parsed.text || parsed.transcript)) || (typeof text === 'string' ? text : '');
    return new Response(JSON.stringify({ ok:true, transcript: String(transcript || '').trim(), raw: parsed || text }), { status:200, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ ok:false, error: String(err) }), { status:500, headers: CORS_HEADERS });
  }
}
