// functions/generate.js — komplett fil (ersätter befintlig).
// Stödjer ageMin/ageMax + length (short|medium|long) + bakåtkompatibilitet med ageRange.
// System prompt innehåller instruktion: skriv med spänning, undvik floskelslut, och följ längdönskemål.

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('origin') || env.BN_ALLOWED_ORIGIN || '*';
  const CORS = {
    "Content-Type": "application/json;charset=utf-8",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    // Läs body (POST) eller query (GET)
    let body = {};
    if (request.method === 'POST') {
      body = await request.json().catch(()=>({}));
    } else {
      const u = new URL(request.url);
      body = Object.fromEntries(u.searchParams.entries());
    }

    const prompt = (body.prompt || body?.idea || '').toString().trim();
    if (!prompt) return new Response(JSON.stringify({ ok:false, error:'Missing prompt' }), { status:400, headers: CORS });

    // ageMin/ageMax eller ageRange
    let ageMin = body.ageMin !== undefined ? Number(body.ageMin) : null;
    let ageMax = body.ageMax !== undefined ? Number(body.ageMax) : null;
    let lengthPref = body.length || body.lengthCategory || null; // 'short'|'medium'|'long' or null
    let legacyAgeRange = body.ageRange || null;

    if ((!ageMin && ageMin !== 0) && legacyAgeRange) {
      const m = String(legacyAgeRange).trim().match(/^(\d+)\s*[-–]\s*(\d+)/);
      if (m) { ageMin = Number(m[1]); ageMax = Number(m[2]); }
      else {
        const s = String(legacyAgeRange).trim().match(/^(\d+)$/);
        if (s) { ageMin = Number(s[1]); ageMax = ageMin; }
      }
    }

    // If single values (like "1" or "2"), ensure both min and max set
    if (ageMin !== null && (ageMax === null || isNaN(ageMax))) ageMax = ageMin;

    // Fallback default age if missing
    if (ageMin === null || isNaN(ageMin) || ageMax === null || isNaN(ageMax)) {
      ageMin = 3; ageMax = 4;
    }

    // Map lengthPref + age interval to length instructions and token cap
    function getLengthInstructionAndTokens(minAge, maxAge, lengthPref) {
      // Baseline words by age group (approx)
      const ageSpan = `${minAge}-${maxAge}`;
      let targetWords = 200;
      if (minAge <= 2) targetWords = 60;        // 1-2 år: mycket kort
      else if (minAge <= 4) targetWords = 120;  // 3-4 år: kort
      else if (minAge <= 6) targetWords = 220;  // 5-6
      else if (minAge <= 8) targetWords = 350;  // 7-8
      else if (minAge <= 10) targetWords = 520; // 9-10
      else targetWords = 650;                   // 11-12

      // Adjust by lengthPref
      if (lengthPref === 'short') targetWords = Math.max(40, Math.round(targetWords * 0.35));
      else if (lengthPref === 'medium') targetWords = Math.round(targetWords * 0.8);
      else if (lengthPref === 'long') targetWords = Math.round(Math.max(targetWords, targetWords * 1.5));

      // Convert words -> rough tokens (token ~ 0.75 words): tokens = words * 1.4 (conservative)
      const maxTokens = Math.min(4000, Math.round(targetWords * 1.4) + 100);

      const lengthInstruction = `Skriv en berättelse anpassad för barn ${minAge}–${maxAge} år. Sikta på ungefär ${targetWords} ord (ungefär ${Math.round(targetWords/150)}–${Math.round(targetWords/100)} min lästid beroende på tempo).`;

      return { lengthInstruction, maxTokens };
    }

    const { lengthInstruction, maxTokens } = getLengthInstructionAndTokens(ageMin, ageMax, lengthPref);

    // System prompt: tydligt krav på spänning + inga floskelslut
    const sysParts = [
      "Du är en trygg, varm och skicklig sagoberättare på svenska.",
      lengthInstruction,
      `Åldersintervall: ${ageMin}-${ageMax} år. Anpassa språk, rytm och längd efter åldern.`,
      "Skriv med god spänning och berättarteknik: använd konkret handling, tydlig konflikt och stegvis upplösning.",
      "VIKTIGT: Undvik platta eller klichéartade slut (inga trötta floskler som \"och så levde de lyckliga\"). Avsluta med ett fint, lugnt eller öppet slut som känns trovärdigt.",
      "Svar endast med berättelsetexten — inga rubriker, inga instruktioner, inga metadata."
    ].join(' ');

    // Build model payload
    const model = env.OPENAI_MODEL || env.DEFAULT_MODEL || 'gpt-4o-mini';
    const OPENAI_KEY = env.OPENAI_API_KEY;
    if (!OPENAI_KEY) return new Response(JSON.stringify({ ok:false, error:'OPENAI_API_KEY saknas' }), { status:500, headers: CORS });

    const userContent = `Sagaidé: ${prompt}` + (body.heroName ? `\nHjälte: ${body.heroName}` : '');

    const payload = {
      model,
      messages: [
        { role: 'system', content: sysParts },
        { role: 'user', content: userContent }
      ],
      temperature: Number(env.TEMPERATURE || 0.8),
      max_tokens: maxTokens
    };

    // Call OpenAI
    const genRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!genRes.ok) {
      const t = await genRes.text().catch(()=>'(no body)');
      return new Response(JSON.stringify({ ok:false, error: `Upstream model error: ${genRes.status}`, detail: t }), { status: 502, headers: CORS });
    }
    const genJson = await genRes.json().catch(()=>null);
    const storyText = genJson?.choices?.[0]?.message?.content?.trim() || '';

    // Optionally save to D1 DB (existing logic) — minimal safe save
    let savedId = null;
    try {
      if (env.BN_DB) {
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

        const id = (typeof crypto?.randomUUID === 'function') ? crypto.randomUUID() : ('id_' + Date.now());
        const created_at = Date.now();
        await env.BN_DB.prepare(`
          INSERT INTO stories (id, prompt, story, ageRange, heroName, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(id, prompt, storyText, `${ageMin}-${ageMax}`, body.heroName || '', '', created_at).run();
        savedId = id;
      }
    } catch(e){ /* ignore save errors */ }

    return new Response(JSON.stringify({ ok:true, story: storyText, saved_id: savedId }), { status:200, headers: CORS });

  } catch (err) {
    return new Response(JSON.stringify({ ok:false, error: String(err) }), { status:500, headers: CORS });
  }
}
