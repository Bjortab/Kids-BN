// functions/api/get_audio.js
// Returnerar en audio blob lagrad i R2 (binding: BN_AUDIO).
// GET /api/get_audio?key=audio/xxx.webm
// OBS: Denna endpoint streamar objektet direkt och sätter Content-Type enligt metadata.

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('origin') || env.BN_ALLOWED_ORIGIN || '*';
  const corsHeaders = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  try {
    if (request.method === 'OPTIONS') return new Response(null, { status:204, headers: corsHeaders });

    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    if (!key) return new Response('Missing key', { status:400, headers: corsHeaders });

    if (!env.BN_AUDIO) {
      return new Response('R2 binding BN_AUDIO not configured', { status:500, headers: corsHeaders });
    }

    const obj = await env.BN_AUDIO.get(key);
    if (!obj) return new Response('Not found', { status:404, headers: corsHeaders });

    const ct = (obj && obj.httpMetadata && obj.httpMetadata.contentType) ? obj.httpMetadata.contentType : 'application/octet-stream';

    // Stream tillbaka objektets body (ArrayBuffer/ReadableStream)
    const body = obj.body;
    const headers = Object.assign({
      'Content-Type': ct,
      'Cache-Control': 'public, max-age=31536000'
    }, corsHeaders);

    return new Response(body, { status:200, headers });
  } catch (err) {
    return new Response(String(err), { status:500, headers: corsHeaders });
  }
}
