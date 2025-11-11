// functions/api/tts.js
// Robust TTS proxy with R2 cache + server-side retries.
// Config via env:
// - BN_AUDIO (R2 bucket binding)
// - KIDSBN_ALLOWED_ORIGIN (CORS origin, fallback '*')
// - TTS_ENDPOINT or VERTEX_ENDPOINT or ELEVENLABS_ENDPOINT (full URL to TTS provider)
// - TTS_API_KEY (provider key, if needed)

export async function onRequest(context) {
  const { request, env } = context;
  const origin = env.KIDSBN_ALLOWED_ORIGIN || '*';
  const CORS = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) });
  }

  try {
    // Read text in flexible formats
    const ct = (request.headers.get('content-type') || '').toLowerCase();
    let text = '';
    if (ct.includes('application/json')) {
      const body = await request.json().catch(()=>null);
      text = body?.text || body?.message || '';
    } else if (ct.includes('text/plain')) {
      text = await request.text().catch(()=>'');
    } else {
      const form = await request.formData().catch(()=>null);
      if (form) text = form.get('text') || form.get('message') || '';
      if (!text) {
        try { const u = new URL(request.url); text = u.searchParams.get('text') || ''; } catch(e){ }
      }
    }
    text = (text || '').toString().trim();
    if (!text) return new Response(JSON.stringify({ ok:false, error:'Missing text' }), { status:400, headers: Object.assign({ 'Content-Type':'application/json' }, CORS) });

    // voice param
    const bodyParsed = (ct.includes('application/json') ? (await request.json().catch(()=>({}))) : {});
    const voice = bodyParsed?.voice || (new URL(request.url)).searchParams.get('voice') || 'default';

    // Normalize text to build deterministic cache key
    function normalize(s){ return (s||'').replace(/\s+/g,' ').trim().toLowerCase().slice(0,10000); }
    const normalized = normalize(text + '|' + voice);

    async function sha256hex(s){
      const enc = new TextEncoder().encode(s);
      const h = await crypto.subtle.digest('SHA-256', enc);
      return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,'0')).join('');
    }

    const hash = await sha256hex(normalized);
    const r2Key = `tts/${hash}.mp3`;

    // If R2 binding exists, try cached object first
    if (env.BN_AUDIO) {
      try {
        const existing = await env.BN_AUDIO.get(r2Key);
        if (existing) {
          const ct = (existing.httpMetadata && existing.httpMetadata.contentType) || 'audio/mpeg';
          const headers = Object.assign({
            'Content-Type': ct,
            'Cache-Control': 'public, max-age=31536000, immutable'
          }, CORS);
          return new Response(existing.body, { status: 200, headers });
        }
      } catch (e) {
        console.warn('[tts] R2 read error', e);
        // fallthrough -> try generate
      }
    }

    // Build provider URL and headers
    const providerUrl = env.TTS_ENDPOINT || env.VERTEX_ENDPOINT || env.ELEVENLABS_ENDPOINT;
    if (!providerUrl) {
      return new Response(JSON.stringify({ ok:false, error:'No TTS provider configured (TTS_ENDPOINT missing)' }), { status:500, headers: Object.assign({ 'Content-Type':'application/json' }, CORS) });
    }

    const providerHeaders = {
      'Content-Type': 'application/json',
      'Authorization': env.TTS_API_KEY ? `Bearer ${env.TTS_API_KEY}` : (env.VERTEX_API_KEY ? `Bearer ${env.VERTEX_API_KEY}` : '')
    };

    // Server-side fetch with retries
    async function fetchWithRetries(url, opts = {}, retries = 3, baseDelay = 300) {
      for (let i=0;i<=retries;i++){
        try {
          const r = await fetch(url, opts);
          if ([429,502,503,504].includes(r.status)) {
            if (i === retries) return r;
            await new Promise(res => setTimeout(res, baseDelay * Math.pow(2,i)));
            continue;
          }
          return r;
        } catch (err) {
          if (i === retries) throw err;
          await new Promise(res => setTimeout(res, baseDelay * Math.pow(2,i)));
        }
      }
    }

    // Prepare payload for provider — keep minimal; providers differ so allow raw pass-through via env
    const providerPayload = {
      text,
      voice
    };

    // Call provider
    const providerRes = await fetchWithRetries(providerUrl, {
      method: 'POST',
      headers: providerHeaders,
      body: JSON.stringify(providerPayload)
    }, 3, 400);

    if (!providerRes || !providerRes.ok) {
      const bodyText = await (providerRes ? providerRes.text().catch(()=>'(no body)') : Promise.resolve('(no response)'));
      console.error('[tts] provider failed', providerRes ? providerRes.status : 'no-res', bodyText.slice ? bodyText.slice(0,200) : bodyText);
      // Return concise error to client but include a short id (hash) to correlate logs
      return new Response(JSON.stringify({ ok:false, error:'TTS upstream failed', status: providerRes ? providerRes.status : 'no-response', key: hash }), { status:502, headers: Object.assign({ 'Content-Type':'application/json' }, CORS) });
    }

    // Got audio — read bytes
    const audioBuf = await providerRes.arrayBuffer();

    // Store in R2 asynchronously (if binding exists)
    if (env.BN_AUDIO) {
      try {
        // put with content-type
        const contentType = providerRes.headers.get('Content-Type') || 'audio/mpeg';
        await env.BN_AUDIO.put(r2Key, audioBuf, { httpMetadata: { contentType } });
      } catch (e) {
        console.warn('[tts] R2 write failed', e);
        // continue; still return audio to client
      }
    }

    // Return audio with cache headers
    const headers = Object.assign({
      'Content-Type': providerRes.headers.get('Content-Type') || 'audio/mpeg',
      'Cache-Control': 'public, max-age=31536000, immutable'
    }, CORS);

    return new Response(audioBuf, { status: 200, headers });

  } catch (err) {
    console.error('[tts] unexpected error', err);
    return new Response(JSON.stringify({ ok:false, error:'Internal server error' }), { status:500, headers: Object.assign({ 'Content-Type':'application/json' }, CORS) });
  }
}
