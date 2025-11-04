// functions/api/save_story.js
// Sparar prompt/transcript/story i D1 (BN_DB) och optionalt audio i R2 (BN_AUDIO).
// Accepts JSON: { prompt, transcript, story, ageRange, heroName, userId?, audioBase64?, audioContentType? }

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('origin') || env.BN_ALLOWED_ORIGIN || '*';
  const headers = { "Content-Type": "application/json;charset=utf-8", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

  try {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return new Response(JSON.stringify({ ok:false, error:'Use POST' }), { status:405, headers });

    let body = {};
    try { body = await request.json(); } catch(e){ return new Response(JSON.stringify({ ok:false, error:'Invalid JSON' }), { status:400, headers }); }

    const prompt = (body.prompt || '').toString();
    const transcript = (body.transcript || '').toString();
    const story = (body.story || '').toString();
    const ageRange = (body.ageRange || '').toString();
    const heroName = (body.heroName || '').toString();
    const userId = (body.userId || body.created_by || '').toString();
    const audioBase64 = body.audioBase64 || null;
    const audioContentType = body.audioContentType || 'audio/webm';
    const embedding = body.embedding || null;

    if (!story && !prompt) return new Response(JSON.stringify({ ok:false, error:'Missing story or prompt' }), { status:400, headers });
    if (!env.BN_DB) return new Response(JSON.stringify({ ok:false, error:'D1 binding BN_DB not configured' }), { status:500, headers });

    await env.BN_DB.prepare(`
      CREATE TABLE IF NOT EXISTS stories (
        id TEXT PRIMARY KEY,
        prompt TEXT,
        embedding TEXT,
        story TEXT,
        ageRange TEXT,
        heroName TEXT,
        created_by TEXT,
        audio_key TEXT,
        created_at INTEGER,
        saved_flag INTEGER DEFAULT 0
      )
    `).run();

    let audio_key = null;
    if (audioBase64 && env.BN_AUDIO) {
      try {
        const b64 = String(audioBase64).split(',').pop();
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const ext = (audioContentType || '').split('/')[1] || 'webm';
        const key = `audio/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
        await env.BN_AUDIO.put(key, bytes, { httpMetadata: { contentType: audioContentType } });
        audio_key = key;
      } catch (e) { console.warn('[save_story] R2 upload failed', e); }
    }

    const id = (typeof crypto?.randomUUID === 'function') ? crypto.randomUUID() : ('id_' + Date.now());
    const now = Date.now();
    const embJson = embedding ? JSON.stringify(embedding) : null;

    await env.BN_DB.prepare(`
      INSERT INTO stories (id, prompt, embedding, story, ageRange, heroName, created_by, audio_key, created_at, saved_flag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, prompt, embJson, story, ageRange, heroName, userId || '', audio_key, now, 1).run();

    const audio_url = audio_key ? `/api/get_audio?key=${encodeURIComponent(audio_key)}` : null;
    return new Response(JSON.stringify({ ok:true, id, audio_key, audio_url }, null, 2), { status:200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ ok:false, error: String(err) }, null, 2), { status:500, headers });
  }
}
