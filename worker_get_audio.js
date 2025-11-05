// worker_get_audio.js
// Cloudflare Worker to serve cached audio from R2
// GET /api/get_audio?key=tts/xxxxx.mp3

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('origin') || env.BN_ALLOWED_ORIGIN || '*';
    const CORS_HEADERS = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      
      if (request.method !== 'GET') {
        return new Response('Method not allowed', { 
          status: 405, 
          headers: CORS_HEADERS 
        });
      }

      const url = new URL(request.url);
      const key = url.searchParams.get('key');
      
      if (!key) {
        return new Response('Missing key parameter', { 
          status: 400, 
          headers: CORS_HEADERS 
        });
      }
      
      if (!env.BN_AUDIO) {
        return new Response('R2 binding BN_AUDIO not configured', { 
          status: 500, 
          headers: CORS_HEADERS 
        });
      }

      // Fetch object from R2
      const obj = await env.BN_AUDIO.get(key);
      
      if (!obj) {
        return new Response('Audio file not found', { 
          status: 404, 
          headers: CORS_HEADERS 
        });
      }

      // Get content type from metadata or default to audio/mpeg
      const contentType = obj.httpMetadata?.contentType || 'audio/mpeg';
      
      // Build response headers with aggressive caching
      const headers = {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        ...CORS_HEADERS
      };

      return new Response(obj.body, { status: 200, headers });
      
    } catch (err) {
      console.error('[worker_get_audio] Error:', err);
      return new Response(String(err), { 
        status: 500, 
        headers: CORS_HEADERS 
      });
    }
  }
};
