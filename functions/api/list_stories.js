// functions/api/list_stories.js
// Returnerar sparade sagor från D1 (binding: BN_DB).
// GET: /api/list_stories?limit=10
// Response: { ok:true, stories: [ { id, prompt, transcript, story, ageRange, heroName, audio_key, audio_url, created_at } ] }

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

    if (!env.BN_DB) {
      return new Response(JSON.stringify({ ok:false, error:'D1 binding BN_DB not configured' }), { status:500, headers });
    }

    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get('limit') || 20), 200);

    // Ensure table exists (no-op if exists)
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

    const res = await env.BN_DB.prepare(`
      SELECT id, prompt, transcript, story, ageRange, heroName, audio_key, created_at
      FROM stories
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(limit).all();

    const rows = (res && res.results) ? res.results : [];
    // Lägg till audio_url om audio_key finns
    const stories = rows.map(r => {
      return Object.assign({}, r, {
        audio_url: r.audio_key ? `/api/get_audio?key=${encodeURIComponent(r.audio_key)}` : null
      });
    });

    return new Response(JSON.stringify({ ok:true, stories }, null, 2), { status:200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ ok:false, error:String(err) }, null, 2), { status:500, headers });
  }
}
