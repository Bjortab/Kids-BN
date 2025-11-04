// functions/api/tts.js
// TTS endpoint med R2 cache + daglig limit (D1 metrics).
// - Deterministisk key: SHA256(text||voice)
// - Återanvänder R2 (env.BN_AUDIO) om audio finns.
// - Om ej finns: kolla DAILY_TTS_LIMIT (env.DAILY_TTS_LIMIT) via D1 (env.BN_DB), generera via Google TTS och spara i R2.
// Response: audio bytes + headers (X-Audio-Key, X-Cost-Warning vid limit).

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('origin') || env.BN_ALLOWED_ORIGIN || '*';
  const CORS = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (request.method === 'OPTIONS') return new Response(null, { status:204, headers: CORS });
  if (request.method !== 'POST') return new Response(JSON.stringify({ ok:false, error:'Use POST' }), { status:405, headers: Object.assign({ "Content-Type": "application/json;charset=utf-8" }, CORS) });

  let body = {};
  try { body = await request.json(); } catch(e){ body = {}; }
  const text = (body.text || body.message || '').toString().trim();
  const voice = (body.voice || 'sv-SE-Wavenet-A').toString();
  const userId = (body.userId || '').toString();

  if (!text) return new Response(JSON.stringify({ ok:false, error:'Missing text' }), { status:400, headers: Object.assign({ "Content-Type": "application/json;charset=utf-8" }, CORS) });

  async function sha256hex(s) {
    const enc = new TextEncoder();
    const data = enc.encode(s);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2,'0')).join('');
  }

  const keyInput = `${text}||${voice}`;
  const hash = await sha256hex(keyInput);
  const r2Key = `tts/${hash}.mp3`;

  // Try R2
  if (env.BN_AUDIO) {
    try {
      const existing = await env.BN_AUDIO.get(r2Key);
      if (existing) {
        const ct = (existing && existing.httpMetadata && existing.httpMetadata.contentType) ? existing.httpMetadata.contentType : 'audio/mpeg';
        const headers = Object.assign({
          'Content-Type': ct,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Audio-Key': r2Key
        }, CORS);
        return new Response(existing.body, { status:200, headers });
      }
    } catch (e) { console.warn('[tts] R2 get failed', e); }
  }

  // Check daily limit
  const DAILY_LIMIT = Number(env.DAILY_TTS_LIMIT || 500);
  if (env.BN_DB) {
    try {
      await env.BN_DB.prepare(`
        CREATE TABLE IF NOT EXISTS metrics (
          k TEXT PRIMARY KEY,
          v INTEGER
        )
      `).run();
      const dayKey = 'tts_' + (new Date().toISOString().slice(0,10));
      const r = await env.BN_DB.prepare(`SELECT v FROM metrics WHERE k = ?`).bind(dayKey).all();
      const cur = (r && r.results && r.results[0] && r.results[0].v) ? Number(r.results[0].v) : 0;
      if (cur >= DAILY_LIMIT) {
        return new Response(JSON.stringify({ ok:false, error:'daily_tts_limit_exceeded' }), { status:429, headers: Object.assign({ "Content-Type": "application/json;charset=utf-8", "X-Cost-Warning": "1" }, CORS) });
      }
    } catch (e) { console.warn('[tts] metrics check failed', e); }
  }

  const googleKey = env.GOOGLE_TTS_KEY || env.GOOGLE_TTS_API_KEY;
  if (!googleKey) return new Response(JSON.stringify({ ok:false, error:'Missing GOOGLE_TTS_KEY' }), { status:500, headers: Object.assign({ "Content-Type": "application/json;charset=utf-8" }, CORS) });

  try {
    const reqBody = { input: { text }, voice: { languageCode: 'sv-SE', name: voice }, audioConfig: { audioEncoding: 'MP3' } };
    const resp = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(googleKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody)
    });
    if (!resp.ok) {
      const t = await resp.text().catch(()=>'');
      return new Response(JSON.stringify({ ok:false, error:'Google TTS failed', details: t }), { status:502, headers: Object.assign({ "Content-Type": "application/json;charset=utf-8" }, CORS) });
    }

    const data = await resp.json().catch(()=>null);
    const audioContent = data?.audioContent;
    if (!audioContent) return new Response(JSON.stringify({ ok:false, error:'No audioContent' }), { status:502, headers: Object.assign({ "Content-Type": "application/json;charset=utf-8" }, CORS) });

    // decode
    const binaryString = atob(audioContent);
    const len = binaryString.length;
    const arr = new Uint8Array(len);
    for (let i=0;i<len;i++) arr[i] = binaryString.charCodeAt(i);

    if (env.BN_AUDIO) {
      try { await env.BN_AUDIO.put(r2Key, arr, { httpMetadata: { contentType: 'audio/mpeg' } }); } catch(e){ console.warn('[tts] R2 put failed', e); }
    }

    if (env.BN_DB) {
      try {
        const dayKey = 'tts_' + (new Date().toISOString().slice(0,10));
        await env.BN_DB.prepare(`INSERT OR REPLACE INTO metrics (k, v) VALUES (?, COALESCE((SELECT v FROM metrics WHERE k = ?), 0) + 1)`).bind(dayKey, dayKey).run();
      } catch(e){ console.warn('[tts] metrics increment failed', e); }
    }

    const headers = Object.assign({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Audio-Key': r2Key }, CORS);
    return new Response(arr.buffer, { status:200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ ok:false, error: String(err) }), { status:500, headers: Object.assign({ "Content-Type": "application/json;charset=utf-8" }, CORS) });
  }
}
