// functions/whisper_transcribe.js
// Pages Function: POST /api/whisper_transcribe  (multipart/form-data, fält 'file')
// Returnerar JSON: { ok:true, text: "..." } eller { ok:false, error: "..." }
// Kräver: OPENAI_API_KEY i Pages Variables & Secrets

const ALLOWED_ORIGIN = '*'; // Byt till din produktdomän när du går i prod, t.ex. https://kids-bn.pages.dev

export const onRequestOptions = async ({ env }) => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
};

export const onRequestPost = async ({ request, env }) => {
  try {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return json({ ok: false, error: 'Saknar OPENAI_API_KEY' }, 500);

    const contentType = request.headers.get('content-type') || '';
    // Accept multipart/form-data OR direct audio/* upload
    let formData;
    if (contentType.includes('multipart/form-data')) {
      formData = await request.formData();
      var file = formData.get('file');
      var language = formData.get('language') || 'sv';
    } else {
      // fallback: accept raw audio body
      const buf = await request.arrayBuffer();
      file = new Blob([buf], { type: contentType || 'audio/webm' });
      language = 'sv';
    }

    if (!file) return json({ ok: false, error: "Missing 'file' field" }, 400);

    // Build forward form
    const forward = new FormData();
    forward.append('file', file, 'speech.webm');
    forward.append('model', env.WHISPER_MODEL || 'whisper-1');
    forward.append('language', language);

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`
        // Do NOT set Content-Type; fetch will set multipart boundary
      },
      body: forward
    });

    const contentTypeResp = resp.headers.get('content-type') || 'application/json';
    const textResp = await resp.text();

    if (!resp.ok) {
      // Try to parse OpenAI error body
      let parsed = textResp;
      try { parsed = JSON.parse(textResp); } catch (e) {}
      return new Response(JSON.stringify({ ok: false, error: 'Upstream error', detail: parsed }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }
      });
    }

    // Success: OpenAI returns JSON with text
    let data;
    try { data = JSON.parse(textResp); } catch (e) { data = { text: textResp }; }
    const text = (data?.text || '').trim();

    return new Response(JSON.stringify({ ok: true, text }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }
    });
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err) }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOWED_ORIGIN }
  });
}
