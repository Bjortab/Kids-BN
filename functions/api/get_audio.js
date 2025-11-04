// functions/api/get_audio.js
// Hämta audio direkt från R2 (BN_AUDIO) med bra cache‑headers.
// GET /api/get_audio?key=audio/xxxx.mp3

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('origin') || env.BN_ALLOWED_ORIGIN || '*';
  const CORS_HEADERS = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  try {
    if (request.method === 'OPTIONS') return new Response(null, { status:204, headers: CORS_HEADERS });
    if (request.method !== 'GET') return new Response('Method not allowed', { status:405, headers: CORS_HEADERS });

    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    if (!key) return new Response('Missing key', { status:400, headers: CORS_HEADERS });
    if (!env.BN_AUDIO) return new Response('R2 binding BN_AUDIO not configured', { status:500, headers: CORS_HEADERS });

    const obj = await env.BN_AUDIO.get(key);
    if (!obj) return new Response('Not found', { status:404, headers: CORS_HEADERS });

    const ct = (obj && obj.httpMetadata && obj.httpMetadata.contentType) ? obj.httpMetadata.contentType : 'application/octet-stream';
    const headers = Object.assign({ 'Content-Type': ct, 'Cache-Control': 'public, max-age=31536000, immutable' }, CORS_HEADERS);
    return new Response(obj.body, { status:200, headers });
  } catch (err) {
    return new Response(String(err), { status:500, headers: CORS_HEADERS });
  }
}
