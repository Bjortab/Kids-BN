// functions/generate.js
// Uppdaterad version (bugfix): använder den korrekt namngivna variabeln finishReason i returobjektet.
// Innehåller: ord->tokens mappning, env-override för max tokens, continuation retry vid token-avklippning.
//
// OBS: Sätt env.OPENAI_API_KEY och valfri OPENAI_MAX_OUTPUT_TOKENS i Pages/Functions env.

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

    // ageMin/ageMax eller ageRange (legacy)
    let ageMin = (body.ageMin !== undefined && body.ageMin !== '') ? Number(body.ageMin) : null;
    let ageMax = (body.ageMax !== undefined && body.ageMax !== '') ? Number(body.ageMax) : null;
    let lengthPref = body.length || body.lengthCategory || null; // 'short'|'medium'|'long' or null
    let legacyAgeRange = body.ageRange || null;

    if ((ageMin === null || Number.isNaN(ageMin)) && legacyAgeRange) {
      const m = String(legacyAgeRange).trim().match(/^(\d+)\s*[-–]\s*(\d+)/);
      if (m) { ageMin = Number(m[1]); ageMax = Number(m[2]); }
      else {
        const s = String(legacyAgeRange).trim().match(/^(\d+)$/);
        if (s) { ageMin = Number(s[1]); ageMax = ageMin; }
      }
    }

    // If single values (like "1" or "2"), ensure both min and max set
    if (ageMin !== null && (ageMax === null || Number.isNaN(ageMax))) ageMax = ageMin;

    // Fallback default age if missing
    if (ageMin === null || Number.isNaN(ageMin) || ageMax === null || Number.isNaN(ageMax)) {
      ageMin = 3; ageMax = 4;
    }

    // Funktion: mappa ålder + längdpref -> instruktion + max_tokens
    function getLengthInstructionAndTokens(minAge, maxAge, lengthPref) {
      // Baseline målord per age
      let targetWords;
      if (minAge <= 2) targetWords = 60;        // 1 år / 2 år: mycket kort
      else if (minAge <= 4) targetWords = 120;  // 3-4 år
      else if (minAge <= 6) targetWords = 220;  // 5-6 år
      else if (minAge <= 8) targetWords = 350;  // 7-8 år
      else if (minAge <= 10) targetWords = 520; // 9-10 år
      else targetWords = 650;                   // 11-12 år

      // Modifiera efter lengthPref
      if (lengthPref === 'short') targetWords = Math.max(40, Math.round(targetWords * 0.35));
      else if (lengthPref === 'medium') targetWords = Math.round(targetWords * 0.9);
      else if (lengthPref === 'long') targetWords = Math.round(Math.max(targetWords, targetWords * 1.6));

      // Konservativ tokens-uppskattning: tokens ≈ words * 1.45
      const estimatedTokens = Math.round(targetWords * 1.45);
      // Buffert så vi undviker klippning
      let maxTokens = Math.min(24000, estimatedTokens + 500);

      // Tillåt override via env (sätt detta i Pages Functions env om du behöver mer)
      const envOverride = Number(env.OPENAI_MAX_OUTPUT_TOKENS || env.MAX_OUTPUT_TOKENS || env.OPENAI_MAX_TOKENS || 0);
      if (envOverride && !Number.isNaN(envOverride) && envOverride > 0) {
        // konservativ gräns
        maxTokens = Math.min(32000, envOverride);
      }

      const lengthInstruction = `Skriv en berättelse anpassad för barn ${minAge}–${maxAge} år. Sikta på ungefär ${targetWords} ord.`;

      return { lengthInstruction, maxTokens };
    }

    const { lengthInstruction, maxTokens } = getLengthInstructionAndTokens(ageMin, ageMax, lengthPref);

    // System prompt: extra instruktion mot abrupt avslut
    const sysParts = [
      "Du är en trygg, varm och skicklig sagoberättare på svenska.",
      lengthInstruction,
      `Åldersintervall: ${ageMin}-${ageMax} år. Anpassa språk, rytm och längd efter åldern.`,
      "Skriv med god spänning och berättarteknik: använd konkret handling, tydlig konflikt och stegvis upplösning.",
      "VIKTIGT: Undvik platta eller klichéartade slut (inga trötta floskler som \"och så levde de lyckliga\"). Avsluta med ett fint, lugnt eller öppet slut som känns trovärdigt.",
      "Om svaret riskerar att bli för långt, prioritera att avsluta hela meningar och ge ett komplett slut hellre än att bli avklippt mitt i en mening.",
      "Svar endast med berättelsetexten — inga rubriker, inga instruktioner, inga metadata."
    ].join(' ');

    // Modellen och nyckel
    const model = env.OPENAI_MODEL || env.DEFAULT_MODEL || 'gpt-4o-mini';
    const OPENAI_KEY = env.OPENAI_API_KEY;
    if (!OPENAI_KEY) return new Response(JSON.stringify({ ok:false, error:'OPENAI_API_KEY saknas' }), { status:500, headers: CORS });

    const userContent = `Sagaidé: ${prompt}` + (body.heroName ? `\nHjälte: ${body.heroName}` : '');

    // Bygg payload för första generation
    const finalMaxTokens = Math.min(32000, Number(maxTokens || 1500)); // säker cap
    const payload = {
      model,
      messages: [
        { role: 'system', content: sysParts },
        { role: 'user', content: userContent }
      ],
      temperature: Number(env.TEMPERATURE || 0.8),
      max_tokens: finalMaxTokens
    };

    // Funktion för att kalla OpenAI
    async function callOpenAI(payload) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const t = await res.text().catch(()=>'');
        throw new Error(`Model error ${res.status}: ${t}`);
      }
      const j = await res.json().catch(()=>null);
      return j;
    }

    // Kör första anropet
    let genJson = null;
    try {
      genJson = await callOpenAI(payload);
    } catch (err) {
      return new Response(JSON.stringify({ ok:false, error: String(err) }), { status:502, headers: CORS });
    }

    // Extrahera text och finish_reason
    const choice = genJson?.choices?.[0] || null;
    let storyText = choice?.message?.content?.trim() || '';
    const finishReason = choice?.finish_reason || null;

    // Om modellen avbröts pga length -> försök en kontrollerad "continue" (max 2 retries)
    let continued = false;
    if (finishReason === 'length' || (storyText && !/[.!?]\s*$/.test(storyText) && (choice?.message?.content?.length || 0) > (finalMaxTokens * 0.5))) {
      // Gör upp till 2 fortsättningsanrop
      let retries = 0;
      while (retries < 2 && (finishReason === 'length' || (storyText && !/[.!?]\s*$/.test(storyText)))) {
        retries++;
        continued = true;
        // Skicka en kort prompt som ber modellen att fortsätta där den slutade
        const tail = storyText.slice(-400); // ge lite kontext
        const contUser = `Fortsätt berättelsen där du slutade. Börja direkt med fortsättningen och avsluta på ett komplett, trovärdigt sätt. Kontext (sista delen): "${tail}"`;
        const contPayload = {
          model,
          messages: [
            { role: 'system', content: "Fortsätt berättelsen. Svara endast med berättelsetexten." },
            { role: 'user', content: contUser }
          ],
          temperature: Number(env.TEMPERATURE || 0.8),
          max_tokens: Math.min(2000, Math.round(finalMaxTokens / 2))
        };

        try {
          const contJson = await callOpenAI(contPayload);
          const contChoice = contJson?.choices?.[0] || null;
          const contText = contChoice?.message?.content?.trim() || '';
          const contFinish = contChoice?.finish_reason || null;
          // Append continuation
          if (contText) {
            storyText += (storyText.endsWith('\n') ? '' : '\n') + contText;
          }
          // Om continuation avslutades normalt, bryt
          if (contFinish !== 'length' && /[.!?]\s*$/.test(contText)) break;
        } catch (e) {
          console.warn('[generate] continuation failed', e);
          break;
        }
      }
    }

    // Spara i D1 DB om tillgänglig (samma struktur som tidigare)
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
    } catch(e){ console.warn('[generate] save failed', e); /* ignore */ }

    // Returnera svar — använd korrekt variabel finishReason
    return new Response(JSON.stringify({ ok:true, story: storyText, saved_id: savedId, continued, finish_reason: finishReason }), { status:200, headers: CORS });

  } catch (err) {
    return new Response(JSON.stringify({ ok:false, error: String(err) }), { status:500, headers: CORS });
  }
}
