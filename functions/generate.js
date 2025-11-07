// functions/generate.js
// Uppdaterad promptinstruktioner för mer äventyr/spänning, särskilt för 11-12 år.
// - Tillåter action/teknologi (laser‑svärd, kanoner) men förbjuder grafiskt våld.
// - Kräver konkreta handlingar, eskalation, konsekvenser och ett "earned" eller öppet slut.
// - Behåller ageMin/ageMax + length + legacy ageRange.
// OBS: Behåll dina env: OPENAI_API_KEY, OPENAI_MAX_OUTPUT_TOKENS etc.

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
    if (ageMin !== null && (ageMax === null || Number.isNaN(ageMax))) ageMax = ageMin;
    if (ageMin === null || Number.isNaN(ageMin) || ageMax === null || Number.isNaN(ageMax)) { ageMin = 3; ageMax = 4; }

    // Map age+length -> lengthInstruction + token estimate (samma approach som förut)
    function getLengthInstructionAndTokens(minAge, maxAge, lengthPref) {
      let targetWords;
      if (minAge <= 2) targetWords = 60;
      else if (minAge <= 4) targetWords = 120;
      else if (minAge <= 6) targetWords = 220;
      else if (minAge <= 8) targetWords = 350;
      else if (minAge <= 10) targetWords = 520;
      else targetWords = 650;

      if (lengthPref === 'short') targetWords = Math.max(40, Math.round(targetWords * 0.35));
      else if (lengthPref === 'medium') targetWords = Math.round(targetWords * 0.9);
      else if (lengthPref === 'long') targetWords = Math.round(Math.max(targetWords, targetWords * 1.6));

      const estimatedTokens = Math.round(targetWords * 1.45);
      let maxTokens = Math.min(24000, estimatedTokens + 500);
      const envOverride = Number(env.OPENAI_MAX_OUTPUT_TOKENS || env.MAX_OUTPUT_TOKENS || env.OPENAI_MAX_TOKENS || 0);
      if (envOverride && !Number.isNaN(envOverride) && envOverride > 0) maxTokens = Math.min(32000, envOverride);
      const lengthInstruction = `Sikta på ungefär ${targetWords} ord.`;

      return { lengthInstruction, maxTokens };
    }

    const { lengthInstruction, maxTokens } = getLengthInstructionAndTokens(ageMin, ageMax, lengthPref);

    // Bygg en tydlig, detaljerad system prompt: särskild hantering för äldre barn
    // Viktigt: inga grafiska beskrivningar av våld, MEN action/strider och teknologi är tillåtna.
    // Krav: konkret handling, eskalation, konsekvens, inga klichéer, avsluta earned eller cliffhanger.
    let sysParts = [
      "Du är en skicklig sagoberättare på svenska. Skriv för barn/använd den ton som passar åldersintervallet.",
      lengthInstruction,
      `Ålder: ${ageMin}-${ageMax} år. Anpassa språk, rytm och komplexitet efter åldern.`,
      "Fokusera på konkret handling och scenisk beskrivning: visa vad händer (handling), inte förklara (talar om känslor).",
      "Bygg eskalation: skapa en tydlig konflikt, stegvis upptrappning och en konkret upplösning eller trovärdig öppen slut/cliffhanger.",
      "När du skriver action/scener (t.ex. laser‑svärd, rymdfarkoster, kanoner), beskriv rörelse, ljud, ljus och konsekvens — men undvik grafiska detaljer eller blod.",
      "Undvik platta, klichéartade slut (t.ex. 'allt löstes tack vare vänskap' eller 'och så levde de lyckliga'). Om vänskap är ett tema, låt det bidra praktiskt på ett trovärdigt sätt (t.ex. en hjälpsam idé eller handling), inte som magisk lösning.",
      "Ge karaktärerna mål, misstag och konsekvenser — ett 'earned' slut eller ett öppet slut med konsekvens är bättre än en tom, lycklig avslutning.",
      "Variera meningarnas längd; använd korta meningar i actionscener för rytm. Avsluta alltid på en hel mening; om modellen riskerar att avbrytas, prioritera att avsluta meningen.",
      "Svara endast med själva berättelsetexten — inga rubriker, inga listor, inga metadata."
    ].join(' ');

    // Extra för 11-12: stärk äventyrs/teknik‑tonen
    if (ageMin >= 11) {
      sysParts += " För 11–12-åringar: tona upp äventyrsaspekten: våga tekniska detaljer (laser‑svärd, riktiga taktiska beslut, rymdnavigering, begränsad teknologi‑terminologi), men håll språket begripligt och spännande. Scenerna kan innehålla strider och risk men inga grafiska skildringar av skada. Avslut ska visa konsekvens, pris eller möjlighet till utveckling — inte en platt moralisk försoning.";
    }

    const model = env.OPENAI_MODEL || env.DEFAULT_MODEL || 'gpt-4o-mini';
    const OPENAI_KEY = env.OPENAI_API_KEY;
    if (!OPENAI_KEY) return new Response(JSON.stringify({ ok:false, error:'OPENAI_API_KEY saknas' }), { status:500, headers: CORS });

    const userContent = `Sagaidé: ${prompt}` + (body.heroName ? `\nHjälte: ${body.heroName}` : '');

    const finalMaxTokens = Math.min(32000, Number(maxTokens || 1500));
    const payload = {
      model,
      messages: [
        { role: 'system', content: sysParts },
        { role: 'user', content: userContent }
      ],
      temperature: Number(env.TEMPERATURE || 0.8),
      max_tokens: finalMaxTokens
    };

    async function callOpenAI(payload) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const t = await res.text().catch(()=>'' );
        throw new Error(`Model error ${res.status}: ${t}`);
      }
      const j = await res.json().catch(()=>null);
      return j;
    }

    // Kör första anropet och hantera avklippning via continuation (som tidigare)
    let genJson;
    try { genJson = await callOpenAI(payload); } catch (err) { return new Response(JSON.stringify({ ok:false, error: String(err) }), { status:502, headers: CORS }); }

    const choice = genJson?.choices?.[0] || null;
    let storyText = choice?.message?.content?.trim() || '';
    const finishReason = choice?.finish_reason || null;
    let continued = false;

    if (finishReason === 'length' || (storyText && !/[.!?]\s*$/.test(storyText) && (choice?.message?.content?.length || 0) > (finalMaxTokens * 0.5))) {
      let retries = 0;
      while (retries < 2 && (finishReason === 'length' || (storyText && !/[.!?]\s*$/.test(storyText)))) {
        retries++;
        continued = true;
        const tail = storyText.slice(-400);
        const contUser = `Fortsätt berättelsen där du slutade. Börja direkt med fortsättningen och avsluta på ett komplett, trovärdigt sätt. Kontext (sista delen): "${tail}"`;
        const contPayload = {
          model,
          messages: [
            { role: 'system', content: "Fortsätt berättelsen. Svara endast med berättelsetexten och undvik att upprepa exakt samma meningar." },
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
          if (contText) storyText += (storyText.endsWith('\n') ? '' : '\n') + contText;
          if (contFinish !== 'length' && /[.!?]\s*$/.test(contText)) break;
        } catch (e) {
          console.warn('[generate] continuation failed', e);
          break;
        }
      }
    }

    // Save minimal to DB if available
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
    } catch (e) { console.warn('[generate] save failed', e); }

    return new Response(JSON.stringify({ ok:true, story: storyText, saved_id: savedId, continued, finish_reason: finishReason }), { status:200, headers: CORS });

  } catch (err) {
    return new Response(JSON.stringify({ ok:false, error: String(err) }), { status:500, headers: CORS });
  }
}
