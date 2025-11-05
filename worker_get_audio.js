// worker_get_audio.js
// Cloudflare Worker to serve audio files from R2 (BN_AUDIO) with edge caching.
// This worker handles GET /api/get_audio?key=tts/... requests.
// It fetches audio from R2 and caches at the Cloudflare edge for performance.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // CORS headers
    const origin = request.headers.get('origin') || env.BN_ALLOWED_ORIGIN || '*';
    const CORS_HEADERS = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { 
        status: 204, 
        headers: CORS_HEADERS 
      });
    }

    // Only allow GET requests
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { 
        status: 405, 
        headers: CORS_HEADERS 
      });
    }

    // Check if path matches /api/get_audio
    if (url.pathname !== '/api/get_audio') {
      return new Response('Not found', { 
        status: 404, 
        headers: CORS_HEADERS 
      });
    }

    try {
      // Get the 'key' parameter (e.g., 'tts/abc123.mp3')
      const key = url.searchParams.get('key');
      if (!key) {
        return new Response('Missing key parameter', { 
          status: 400, 
          headers: CORS_HEADERS 
        });
      }

      // Validate R2 binding
      if (!env.BN_AUDIO) {
        return new Response('R2 binding BN_AUDIO not configured', { 
          status: 500, 
          headers: CORS_HEADERS 
        });
      }

      // Create a cache key for this request
      const cacheKey = new Request(url.toString(), request);
      const cache = caches.default;

      // Try to get from edge cache first
      let response = await cache.match(cacheKey);
      if (response) {
        // Add cache hit header for debugging
        const headers = new Headers(response.headers);
        headers.set('X-Cache-Status', 'HIT');
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      }

      // Not in cache, fetch from R2
      const obj = await env.BN_AUDIO.get(key);
      
      if (!obj) {
        return new Response('Audio file not found', { 
          status: 404, 
          headers: CORS_HEADERS 
        });
      }

      // Get content type from R2 metadata or default to audio/mpeg
      const contentType = obj.httpMetadata?.contentType || 'audio/mpeg';
      
      // Build response headers with aggressive caching
      const responseHeaders = {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable', // 1 year
        'X-Cache-Status': 'MISS',
        'X-Audio-Key': key,
        ...CORS_HEADERS
      };

      // Create response
      response = new Response(obj.body, {
        status: 200,
        headers: responseHeaders
      });

      // Store in edge cache (don't await, let it happen in background)
      // Cloudflare will respect the Cache-Control header
      await cache.put(cacheKey, response.clone());

      return response;

    } catch (err) {
      console.error('[worker_get_audio] Error:', err);
      return new Response(`Internal server error: ${err.message}`, { 
        status: 500, 
        headers: CORS_HEADERS 
      });
    }
  }
};
