// functions/api/tts.js
// TTS endpoint med R2‑cache. 
// - Tar emot POST { text, voice? }
// - Beräknar SHA256(text + '||' + voice) -> key
// - Om key finns i R2 (env.BN_AUDIO) returnerar objektet direkt (binary response).
// - Om inte: anropar Google TTS (eller annan provider enligt env), sparar mp3 i R2 och returnerar audio.
// - Returnerar alltid audio bytes (content-type audio/mpeg) så klienten kan spela direkt.
// - Sätter Cache‑Control så CDN/webbläsare kan cacha och vi tjänar pengar på återanvändning.
//
// Bindningar som används:
// - env.GOOGLE_TTS_KEY eller env.GOOGLE_TTS_API_KEY  (Google TTS API key)
// - env.BN_AUDIO (R2 bucket binding, som redan finns i ditt wrangler.toml)
// Obs: Om du använder annan TTS‑provider, anpassa blocket som anropar Google TTS.

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('origin') || env.BN_ALLOWED_ORIGIN || '*';

  const CORS_HEADERS = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  try {
    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ ok:false, error: 'Method not allowed, use POST' }), { status:405, headers: Object.assign({ "Content-Type": "application/json;charset=utf-8" }, CORS_HEADERS) });
    }

    // Läs body (förväntar JSON)
    let body = {};
    try {
      body = await request.json().catch(()=>{ return {}; });
    } catch(e) { body = {}; }

    const text = (body.text || body.message || '').toString().trim();
    const voice = (body.voice || body.v || 'sv-SE-Wavenet-A').toString().trim(); // default voice

    if (!text) {
      return new Response(JSON.stringify({ ok:false, error: 'Missing text to synthesize' }), { status:400, headers: Object.assign({ "Content-Type": "application/json;charset=utf-8" }, CORS_HEADERS) });
    }

    // Compute deterministic key: SHA-256 of text||voice
    async function sha256hex(s) {
      const enc = new TextEncoder();
      const data = enc.encode(s);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2,'0')).join('');
    }

    const keyInput = `${text}||${voice}`;
    const hash = await sha256hex(keyInput);
    const r2Key = `tts/${hash}.mp3`; // use mp3 since Google returns MP3

    // If R2 binding exists, try to fetch object
    if (env.BN_AUDIO) {
      try {
        const existing = await env.BN_AUDIO.get(r2Key);
        if (existing) {
          // Return cached object bytes directly with proper headers
          const ct = (existing && existing.httpMetadata && existing.httpMetadata.contentType) ? existing.httpMetadata.contentType : 'audio/mpeg';
          const bodyStream = existing.body;
          const headers = Object.assign({
            'Content-Type': ct,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Audio-Key': r2Key
          }, CORS_HEADERS);
          return new Response(bodyStream, { status:200, headers });
        }
      } catch (e) {
        // If fetching from R2 fails, log and continue to generate
        console.warn('[tts] R2 get failed, will regenerate', e);
      }
    }

    // No cached audio — generate via Google TTS (or provider configured)
    const googleKey = env.GOOGLE_TTS_KEY || env.GOOGLE_TTS_API_KEY;
    if (!googleKey) {
      // If no Google key and no R2 cached audio, we can't synthesize
      return new Response(JSON.stringify({ ok:false, error: 'Missing Google TTS key (GOOGLE_TTS_KEY)' }), { status:500, headers: Object.assign({ "Content-Type": "application/json;charset=utf-8" }, CORS_HEADERS) });
    }

    // Build request for Google TTS (synthesize endpoint)
    const reqBody = {
      input: { text },
      voice: { languageCode: 'sv-SE', name: voice },
      audioConfig: { audioEncoding: 'MP3' } // request MP3
    };

    // Call Google TTS
    const resp = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(googleKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody)
    });

    if (!resp.ok) {
      const t = await resp.text().catch(()=>'<no-body>');
      return new Response(JSON.stringify({ ok:false, error: 'Google TTS error', details: t }), { status:502, headers: Object.assign({ "Content-Type": "application/json;charset=utf-8" }, CORS_HEADERS) });
    }

    const data = await resp.json().catch(()=>null);
    const audioContent = data?.audioContent;
    if (!audioContent) {
      return new Response(JSON.stringify({ ok:false, error: 'Google TTS returned no audioContent', raw: data }), { status:502, headers: Object.assign({ "Content-Type": "application/json;charset=utf-8" }, CORS_HEADERS) });
    }

    // Decode base64 to bytes
    let bytes;
    try {
      // atob exists in Pages Functions environment
      const binaryString = atob(audioContent);
      const len = binaryString.length;
      const arr = new Uint8Array(len);
      for (let i = 0; i < len; i++) arr[i] = binaryString.charCodeAt(i);
      bytes = arr;
    } catch (e) {
      // fallback if atob not available (unlikely)
      return new Response(JSON.stringify({ ok:false, error: 'Failed to decode audio content', details: String(e) }), { status:500, headers: Object.assign({ "Content-Type": "application/json;charset=utf-8" }, CORS_HEADERS) });
    }

    // Try to store in R2 (if binding exists)
    if (env.BN_AUDIO) {
      try {
        // Put bytes into R2 with content type
        await env.BN_AUDIO.put(r2Key, bytes, { httpMetadata: { contentType: 'audio/mpeg' } });
      } catch (e) {
        console.warn('[tts] R2 put failed (will still return audio)', e);
      }
    }

    // Return audio bytes (so existing client code that expects binary still works)
    const responseHeaders = Object.assign({
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Audio-Key': r2Key
    }, CORS_HEADERS);

    return new Response(bytes.buffer, { status:200, headers: responseHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ ok:false, error: String(err) }), { status:500, headers: Object.assign({ "Content-Type": "application/json;charset=utf-8" }, CORS_HEADERS) });
  }
}
