// functions/api/tts_vertex.js
// Wraps a Vertex TTS endpoint with retries and R2 caching (if BN_AUDIO present).

export async function onRequestPost({ request, env }) {
  const origin = env.KIDSBN_ALLOWED_ORIGIN || '*';
  const CORS = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (request.method === 'OPTIONS') return new Response(null, { status:204, headers: CORS });

  try {
    const ct = (request.headers.get('content-type') || '').toLowerCase();
    let text = '';
    if (ct.includes('application/json')) {
      const b = await request.json().catch(()=>null);
      text = b?.text || b?.message || '';
    } else if (ct.includes('text/plain')) {
      text = await request.text().catch(()=>'');
    } else {
      const form = await request.formData().catch(()=>null);
      if (form) text = form.get('text') || form.get('message') || '';
      if (!text) {
        try { text = (new URL(request.url)).searchParams.get('text') || ''; } catch(e){}
      }
    }
    text = (text||'').toString().trim();
    if (!text) return new Response(JSON.stringify({ ok:false, error:'Missing text' }), { status:400, headers: Object.assign({ 'Content-Type':'application/json' }, CORS) });

    const voice = (await request.json().catch(()=>({})))?.voice || 'default';

    // Normalize + hash key
    function normalize(s){ return (s||'').replace(/\s+/g,' ').trim().toLowerCase().slice(0,10000); }
    async function sha256hex(s){ const enc=new TextEncoder().encode(s); const h=await crypto.subtle.digest('SHA-256',enc); return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join(''); }
    const hash = await sha256hex(normalize(text + '|' + voice));
    const r2Key = `tts/${hash}.mp3`;

    // Try R2 cache
    if (env.BN_AUDIO) {
      try {
        const existing = await env.BN_AUDIO.get(r2Key);
        if (existing) {
          const ct2 = (existing && existing.httpMetadata && existing.httpMetadata.contentType) ? existing.httpMetadata.contentType : 'audio/mpeg';
          const headers = Object.assign({ 'Content-Type': ct2, 'Cache-Control': 'public, max-age=31536000, immutable' }, CORS);
          return new Response(existing.body, { status:200, headers });
        }
      } catch(e) { console.warn('[tts_vertex] R2 get failed', e); }
    }

    const vertexUrl = env.VERTEX_ENDPOINT || env.TTS_ENDPOINT;
    if (!vertexUrl) return new Response(JSON.stringify({ ok:false, error:'Vertex endpoint not configured' }), { status:500, headers: Object.assign({ 'Content-Type':'application/json' }, CORS) });

    const providerHeaders = { 'Content-Type':'application/json', 'Authorization': env.VERTEX_API_KEY ? `Bearer ${env.VERTEX_API_KEY}` : '' };

    async function fetchWithRetries(url, opts={}, retries=3, base=300){
      for (let i=0;i<=retries;i++){
        try {
          const r = await fetch(url, opts);
          if ([429,502,503,504].includes(r.status)) {
            if (i===retries) return r;
            await new Promise(res=>setTimeout(res, base*Math.pow(2,i)));
            continue;
          }
          return r;
        } catch (err) {
          if (i===retries) throw err;
          await new Promise(res=>setTimeout(res, base*Math.pow(2,i)));
        }
      }
    }

    const payload = { input: text, voice };
    const provRes = await fetchWithRetries(vertexUrl, { method:'POST', headers: providerHeaders, body: JSON.stringify(payload) }, 3, 400);

    if (!provRes || !provRes.ok) {
      const txt = await (provRes ? provRes.text().catch(()=>'') : Promise.resolve('(no response)'));
      console.error('[tts_vertex] provider failed', provRes ? provRes.status : 'no-res', txt.slice ? txt.slice(0,200) : txt);
      return new Response(JSON.stringify({ ok:false, error:'Vertex upstream failed', status: provRes ? provRes.status : 'no-res', key: hash }), { status:502, headers: Object.assign({ 'Content-Type':'application/json' }, CORS) });
    }

    const buf = await provRes.arrayBuffer();
    // Write to R2 if available
    if (env.BN_AUDIO) {
      try { await env.BN_AUDIO.put(r2Key, buf, { httpMetadata: { contentType: provRes.headers.get('Content-Type') || 'audio/mpeg' } }); } catch(e){ console.warn('[tts_vertex] R2 put failed', e); }
    }

    const headersOut = Object.assign({ 'Content-Type': provRes.headers.get('Content-Type') || 'audio/mpeg', 'Cache-Control': 'public, max-age=31536000, immutable' }, CORS);
    return new Response(buf, { status:200, headers: headersOut });

  } catch (e) {
    console.error('[tts_vertex] unexpected', e);
    return new Response(JSON.stringify({ ok:false, error:'Internal error' }), { status:500, headers: Object.assign({ 'Content-Type':'application/json' }, CORS) });
  }
}
