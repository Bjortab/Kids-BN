// functions/api/generate_story.js
// GC v1.1 — Pages Functions (onRequest) + world_state + strikt JSON-svar

export async function onRequest(context) {
  const { request, env } = context;

  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const { prompt = '', world_state = {}, world_summary = '' } = await request.json();

    const system = `
Du är en svensk barnboksförfattare för åldern 7–15. Skriv ett kapitel (ca 300–600 ord).
FÖLJ OBLIGATORISKT:
1) Kausalitet: inga hopp i tid/plats utan övergång. Förklara orsaker före effekter.
2) Konsekvent värld: behåll namn, mål, plats, tid enligt world_state.
3) Inga generiska moralslut; avsluta konkret i scenen.
4) Språk: klar, varierad men enkel svenska (7–15).
5) Inga nya krafter utan foreshadowing.

World state (sammanfattning):
${world_summary}

Returnera EXAKT detta JSON-schema:
{
  "story_text": "kapitlet som plain text",
  "world_state_next": {
    "protagonists": ["..."],
    "location": "...",
    "timeOfDay": "...",
    "goal": "...",
    "constraints": {
      "noSuddenPowers": true,
      "consistentNames": true,
      "groundedPhysics": true,
      "noGenericMoralEnd": true
    },
    "recap": "1–2 meningar som summerar kapitlets förändring"
  }
}
`.trim();

    // — OpenAI-exempel —
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt || '' },
          { role: 'assistant', content: `World state JSON: ${JSON.stringify(world_state || {}, null, 2)}` }
        ]
      })
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      return json({ ok: false, error: 'Model error', detail: t.slice(0, 800) }, 502);
    }

    const data = await resp.json().catch(() => null);
    const raw = data?.choices?.[0]?.message?.content || '';

    const parsed = tryParseJSON(raw);
    if (!parsed || !parsed.story_text) {
      // fallback om modellen råkade svara ren text
      return json({
        ok: true,
        data: {
          story_text: typeof raw === 'string' ? raw : 'Berättelse saknas.',
          world_state_next: world_state || {}
        }
      });
    }

    // mergea constraints från inkommande state om modellen tappat dem
    if (parsed.world_state_next && world_state?.constraints) {
      parsed.world_state_next.constraints = {
        ...world_state.constraints,
        ...(parsed.world_state_next.constraints || {})
      };
    }

    return json({ ok: true, data: parsed });

  } catch (e) {
    return json({ ok: false, error: 'Server error', detail: String(e) }, 500);
  }

  function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
  function tryParseJSON(s) {
    try { return JSON.parse(s); } catch { return null; }
  }
}
