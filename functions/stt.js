export async function onRequestOptions({ env }) {
  return new Response(null, { status: 204, headers: cors(env.BN_ALLOWED_ORIGIN || "*") });
}

export async function onRequestPost({ request, env }) {
  const origin = env.BN_ALLOWED_ORIGIN || "*";
  try {
    const form = await request.formData();
    const file = form.get('file');
    const language = form.get('language') || 'sv';
    if (!file || typeof file === 'string') return json({ error: 'no_file' }, 400, origin);

    const openaiRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: toFormData({ file, model: 'whisper-1', language })
    });
    if (!openaiRes.ok) {
      const err = await openaiRes.text().catch(()=> "");
      return json({ error: 'openai_error', details: err }, 500, origin);
    }
    const data = await openaiRes.json();
    return json({ text: data.text || '' }, 200, origin);
  } catch (e) {
    return json({ error: 'server_error', details: String(e) }, 500, origin);
  }
}

function toFormData(obj) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'file') fd.append('file', v, 'speech.webm');
    else fd.append(k, v);
  }
  return fd;
}
function cors(origin){
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
function json(obj, status, origin){ return new Response(JSON.stringify(obj), { status, headers: { "Content-Type":"application/json", ...cors(origin) } }); }
