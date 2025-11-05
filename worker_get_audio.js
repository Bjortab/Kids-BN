// worker_get_audio.js
// Standalone Cloudflare Worker for serving cached audio from R2
// This worker can be deployed separately to improve CDN cache usage and reduce latency
// Deploy with: wrangler deploy worker_get_audio.js

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // CORS headers
    const origin = request.headers.get('origin') || env.BN_ALLOWED_ORIGIN || '*';
    const CORS_HEADERS = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    // Handle OPTIONS preflight
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

    // Extract key from query parameter: /api/get_audio?key=tts/xxxxx.mp3
    const key = url.searchParams.get('key');
    if (!key) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: 'Missing key parameter' 
      }), { 
        status: 400, 
        headers: { 
          ...CORS_HEADERS, 
          'Content-Type': 'application/json' 
        }
      });
    }

    // Validate R2 binding
    if (!env.BN_AUDIO) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: 'R2 binding BN_AUDIO not configured' 
      }), { 
        status: 500, 
        headers: { 
          ...CORS_HEADERS, 
          'Content-Type': 'application/json' 
        }
      });
    }

    try {
      // Fetch from R2
      const obj = await env.BN_AUDIO.get(key);
      
      if (!obj) {
        return new Response(JSON.stringify({ 
          ok: false, 
          error: 'Audio file not found' 
        }), { 
          status: 404, 
          headers: { 
            ...CORS_HEADERS, 
            'Content-Type': 'application/json' 
          }
        });
      }

      // Get content type from R2 metadata or default to audio/mpeg
      const contentType = obj.httpMetadata?.contentType || 'audio/mpeg';
      
      // Return audio with aggressive CDN caching
      const headers = {
        ...CORS_HEADERS,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Audio-Source': 'r2-cache'
      };

      return new Response(obj.body, { 
        status: 200, 
        headers 
      });

    } catch (err) {
      console.error('[worker_get_audio] Error:', err);
      return new Response(JSON.stringify({ 
        ok: false, 
        error: String(err) 
      }), { 
        status: 500, 
        headers: { 
          ...CORS_HEADERS, 
          'Content-Type': 'application/json' 
        }
      });
    }
  }
};
