// functions/generate.js
// Generera saga med smart cache-beslut baserat på embedding-similaritet.
// - Använder D1 (env.BN_DB) för metadata/storage.
// - Använder OpenAI embeddings (env.OPENAI_API_KEY) för likhetsmätning.
// - Policy:
//   * Ålder 1-4: återanvänd sparad saga om likhet >= SIMILARITY_THRESHOLD.
//   * Ålder 11-12: om sparad saga matchar men skapades av SAMMA user -> skapa NY; om skapad av ANNAN user -> återanvänd.
//   * Annars: generera ny saga, spara i D1 med embedding.
// POST body: { ageRange, heroName, prompt, userId? }
// Response: { ok:true, story, reused:bool, reused_id?:string, saved_id?:string, similarity?:number }

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('origin') || env.BN_ALLOWED_ORIGIN || '*';
  const CORS_HEADERS = {
    "Content-Type": "application/json;charset=utf-8",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  function jsonBody(obj, status = 200) {
    return new Response(JSON.stringify(obj, null, 2), { status, headers: CORS_HEADERS });
  }

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST') return jsonBody({ ok:false, error: 'Use POST' }, 405);

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }

  const prompt = (body.prompt || '').toString().trim();
  const ageRange = (body.ageRange || body.age || '3-4').toString();
  const heroName = (body.heroName || body.hero || '').toString();
  const userId = (body.userId || body.created_by || '').toString();

  if (!prompt) return jsonBody({ ok:false, error: 'Missing prompt' }, 400);

  // Config
  const OPENAI_KEY = env.OPENAI_API_KEY;
  const EMB_MODEL = env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
  const SIMILARITY_THRESHOLD = Number(env.SIMILARITY_THRESHOLD || 0.80);
  const MAX_CANDIDATES = Number(env.MAX_CANDIDATES || 200);
  const DEFAULT_MODEL = env.OPENAI_MODEL || 'gpt-4o-mini';
  const DEFAULT_MAX_TOKENS = Number(env.MAX_OUTPUT_TOKENS || 1500);
  const TEMPERATURE = Number(env.TEMPERATURE || 0.8);

  // Helpers
  function cosine(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i=0;i<a.length;i++){ dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  async function getEmbedding(text) {
    if (!OPENAI_KEY) return null;
    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: text, model: EMB_MODEL })
      });
      if (!res.ok) { console.warn('[embed] upstream failed', res.status); return null; }
      const j = await res.json().catch(()=>null);
      return j?.data?.[0]?.embedding || null;
    } catch (e) { console.warn('[embed] error', e); return null; }
  }

  async function generateStoryWithModel(promptForModel) {
    if (!OPENAI_KEY) throw new Error('Missing OPENAI_API_KEY for generation');
    const sys = [
      "Du är en trygg och snäll sagoberättare för barn på svenska.",
      `Åldersgrupp: ${ageRange}. Anpassa språk och ton efter åldern.`,
      heroName ? `Barnets namn är ${heroName}.` : "",
      "VIKTIGT: Svara endast med själva berättelsetexten — inga rubriker, inga förklaringar."
    ].filter(Boolean).join(' ');
    const payload = {
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: `Sagaidé: ${promptForModel}` }
      ],
      temperature: TEMPERATURE,
      max_tokens: DEFAULT_MAX_TOKENS
    };
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const t = await res.text().catch(()=>'' );
      throw new Error('Model error: ' + t);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || '';
  }

  const promptEmbedding = await getEmbedding(prompt);

  // DB candidate search
  let candidate = null;
  if (env.BN_DB && promptEmbedding) {
    try {
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

      const rowsRes = await env.BN_DB.prepare(`
        SELECT id, prompt, embedding, story, ageRange, heroName, created_by, audio_key, created_at
        FROM stories
        WHERE ageRange = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).bind(ageRange, MAX_CANDIDATES).all();

      const rows = (rowsRes && rowsRes.results) ? rowsRes.results : [];
      let best = { sim: 0, row: null };
      for (const r of rows) {
        try {
          const emb = r.embedding ? JSON.parse(r.embedding) : null;
          if (!emb) continue;
          const sim = cosine(promptEmbedding, emb);
          if (sim > best.sim) { best.sim = sim; best.row = r; }
        } catch(e){ continue; }
      }
      if (best.row && best.sim >= SIMILARITY_THRESHOLD) candidate = { row: best.row, sim: best.sim };
    } catch (e) {
      console.warn('[generate] DB search failed', e);
      candidate = null;
    }
  }

  const ageStr = String(ageRange || '');
  const isYoung = /(^|,|\s)(1|2|3|4)(\D|$)/.test(ageStr);
  const isOlder = /11|12/.test(ageStr);

  try {
    if (candidate) {
      const createdBy = candidate.row.created_by || '';
      if (isYoung) {
        return jsonBody({ ok:true, story: candidate.row.story, reused:true, reused_id: candidate.row.id, similarity: candidate.sim });
      }
      if (isOlder) {
        if (userId && createdBy && userId === createdBy) {
          // same user -> do not reuse => generate
        } else {
          return jsonBody({ ok:true, story: candidate.row.story, reused:true, reused_id: candidate.row.id, similarity: candidate.sim });
        }
      } else {
        return jsonBody({ ok:true, story: candidate.row.story, reused:true, reused_id: candidate.row.id, similarity: candidate.sim });
      }
    }

    // generate new
    const story = await generateStoryWithModel(prompt);

    // save in DB
    let savedId = null;
    if (env.BN_DB) {
      try {
        const id = (typeof crypto?.randomUUID === 'function') ? crypto.randomUUID() : ('id_' + Date.now());
        const created_at = Date.now();
        const embJson = promptEmbedding ? JSON.stringify(promptEmbedding) : null;
        await env.BN_DB.prepare(`
          INSERT INTO stories (id, prompt, embedding, story, ageRange, heroName, created_by, created_at, saved_flag)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(id, prompt, embJson, story, ageRange, heroName, userId || '', created_at, 0).run();
        savedId = id;
      } catch (e) { console.warn('[generate] failed to save story', e); }
    }

    return jsonBody({ ok:true, story, reused:false, saved_id: savedId });
  } catch (err) {
    return jsonBody({ ok:false, error: String(err) }, 500);
  }
}
