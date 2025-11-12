// functions/api/tts_vertex.js
// GC v1 – ren proxy till /api/tts på samma origin
export async function onRequest(context) {
  const { request, env } = context;
  const origin = env.KIDSBN_ALLOWED_ORIGIN || '*';
  const CORS = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  };

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok:false, error:'Method not allowed' }), {
      status: 405, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }

  try {
    const u = new URL(request.url);
    u.pathname = '/api/tts';
    const headers = { 'Content-Type': request.headers.get('content-type') || 'application/json' };
    const auth = request.headers.get('authorization');
    if (auth) headers.Authorization = auth;

    const body = await request.arrayBuffer();
    const res  = await fetch(u.toString(), { method:'POST', headers, body });

    // vidarebefordra svar + CORS
    const out = new Headers(res.headers);
    out.set('Access-Control-Allow-Origin', origin);
    out.set('Vary', 'Origin');
    return new Response(await res.arrayBuffer(), { status: res.status, headers: out });
  } catch (e) {
    console.error('[tts_vertex] proxy error', e);
    return new Response(JSON.stringify({ ok:false, error:'Proxy error', detail:String(e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
}
