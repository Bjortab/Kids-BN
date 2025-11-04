// functions/api/save_story.js
// Sparar prompt/transcript/story i D1 (binding: BN_DB) och optionalt en audio‑blob i R2 (binding: BN_AUDIO).
// Förväntar POST JSON: { prompt, transcript, story, ageRange, heroName, audioBase64?, audioContentType? }
// Om audioBase64 skickas sparas filen i R2 och audio_key lagras i D1.
// RETURN: { ok:true, id, audio_key, audio_url? }

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('origin') || env.BN_ALLOWED_ORIGIN || '*';
  const headers = {
    "Content-Type": "application/json;charset=utf-8",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  try {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ ok:false, error:'Use POST' }), { status:405, headers });
    }

    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ ok:false, error:'Invalid JSON' }), { status:400, headers });
    }

    const prompt = (body.prompt || '').toString();
    const transcript = (body.transcript || '').toString();
    const story = (body.story || '').toString();
    const ageRange = (body.ageRange || '').toString();
    const heroName = (body.heroName || '').toString();
    const audioBase64 = body.audioBase64 || null; // optional base64 string
    const audioContentType = body.audioContentType || 'audio/webm';

    if (!story && !prompt) {
      return new Response(JSON.stringify({ ok:false, error:'Missing story or prompt' }), { status:400, headers });
    }

    // Kontrollera D1 binding
    if (!env.BN_DB) {
      return new Response(JSON.stringify({ ok:false, error:'D1 binding BN_DB not configured' }), { status:500, headers });
    }

    // Skapa tabell om den inte finns
    await env.BN_DB.prepare(`
      CREATE TABLE IF NOT EXISTS stories (
        id TEXT PRIMARY KEY,
        prompt TEXT,
        transcript TEXT,
        story TEXT,
        ageRange TEXT,
        heroName TEXT,
        audio_key TEXT,
        created_at INTEGER
      )
    `).run();

    // Hantera audio -> R2 om audioBase64 ges
    let audio_key = null;
    if (audioBase64 && env.BN_AUDIO) {
      try {
        // Bestäm filändelse utifrån content type (basic)
        const ext = (audioContentType || '').split('/')[1] || 'webm';
        const key = `audio/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
        // decode base64
        const b64 = audioBase64.split(',').pop();
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        // Spara i R2
        await env.BN_AUDIO.put(key, bytes, { httpMetadata: { contentType: audioContentType } });
        audio_key = key;
      } catch (e) {
        console.warn('R2 upload failed', e);
        // fortsätt ändå utan audio
        audio_key = null;
      }
    }

    // Insert i D1
    let id;
    try { id = crypto.randomUUID(); } catch(e) { id = 'id_' + Date.now(); }
    const created_at = Date.now();

    await env.BN_DB.prepare(`
      INSERT INTO stories (id, prompt, transcript, story, ageRange, heroName, audio_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, prompt, transcript, story, ageRange, heroName, audio_key, created_at).run();

    const audio_url = audio_key ? `/api/get_audio?key=${encodeURIComponent(audio_key)}` : null;

    return new Response(JSON.stringify({ ok:true, id, audio_key, audio_url }, null, 2), { status:200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ ok:false, error:String(err) }, null, 2), { status:500, headers });
  }
}
