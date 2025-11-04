// functions/api/list_stories.js
// Returnerar sparade sagor med created_by + audio_url.
// GET: /api/list_stories?limit=10

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('origin') || env.BN_ALLOWED_ORIGIN || '*';
  const headers = { "Content-Type": "application/json;charset=utf-8", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

  try {
    if (request.method === 'OPTIONS') return new Response(null, { status:204, headers });
    if (!env.BN_DB) return new Response(JSON.stringify({ ok:false, error:'D1 binding BN_DB not configured' }), { status:500, headers });

    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get('limit') || 20), 200);

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

    const res = await env.BN_DB.prepare(`
      SELECT id, prompt, embedding, story, ageRange, heroName, created_by, audio_key, created_at
      FROM stories
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(limit).all();

    const rows = (res && res.results) ? res.results : [];
    const stories = rows.map(r => ({
      id: r.id,
      prompt: r.prompt,
      embedding_length: r.embedding ? (JSON.parse(r.embedding).length || null) : null,
      story: r.story,
      ageRange: r.ageRange,
      heroName: r.heroName,
      created_by: r.created_by,
      audio_key: r.audio_key,
      audio_url: r.audio_key ? `/api/get_audio?key=${encodeURIComponent(r.audio_key)}` : null,
      created_at: r.created_at
    }));

    return new Response(JSON.stringify({ ok:true, stories }, null, 2), { status:200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ ok:false, error: String(err) }, null, 2), { status:500, headers });
  }
}
