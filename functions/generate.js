// functions/generate.js
// Pages Function: POST /api/generate
// Anpassad för nya åldersintervall: 7-15 år (7-8, 9-10, 11-12, 13-15)

export async function onRequestOptions({ env }) {
  const origin = env.KIDSBN_ALLOWED_ORIGIN || '*';
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}

export async function onRequestPost({ request, env }) {
  const origin = env.KIDSBN_ALLOWED_ORIGIN || '*';
  try {
    const body = await request.json().catch(() => ({}));
    const prompt = (body?.prompt || '').trim();
    const kidName = (body?.kidName || body?.heroName || 'Vännen').trim();
    const ageGroupRaw = (body?.ageGroup || body?.ageRange || '7-8 år').trim();

    if (!prompt) return json({ error: 'Skriv vad sagan ska handla om.' }, 400, origin);
    if (!env.OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY saknas.' }, 500, origin);

    const ageKey = normalizeAge(ageGroupRaw);
    const { lengthInstruction, maxTokens } = getLengthInstructionAndTokens(ageKey);

    // Strikt system prompt: instruera modellen att endast returnera berättelsetext
    const sys = [
      "Du är en trygg och snäll sagoberättare för barn på svenska.",
      lengthInstruction,
      `Åldersgrupp: ${ageGroupRaw}. Anpassa språk och ton efter åldern.`,
      `Barnets namn är ${kidName}. Inkludera namnet naturligt i berättelsen.`,
      "VIKTIGT: Svara endast med själva berättelsetexten — inga rubriker, inga förklaringar, inga citationstecken. Bara berättelsen."
    ].join(' ');

    const payload = {
      model: env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.8,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: `Sagaidé: ${prompt}` }
      ]
    };
    if (maxTokens) payload.max_tokens = maxTokens;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return json({ error: 'OpenAI fel', details: t }, 502, origin);
    }

    const data = await res.json();
    const storyRaw = data?.choices?.[0]?.message?.content?.trim() || '';
    return json({ story: storyRaw }, 200, origin);
  } catch (e) {
    return json({ error: e?.message || 'Serverfel' }, 500, env.KIDSBN_ALLOWED_ORIGIN || '*');
  }
}

function normalizeAge(raw) {
  const s = (raw || '').toLowerCase();
  if (s.includes('7-8') || s.includes('7–8')) return '7-8';
  if (s.includes('9-10') || s.includes('9–10')) return '9-10';
  if (s.includes('11-12') || s.includes('11–12')) return '11-12';
  if (s.includes('13-15') || s.includes('13–15')) return '13-15';
  // Fallback
  return '7-8';
}

function getLengthInstructionAndTokens(ageKey) {
  switch (ageKey) {
    case '7-8':
      return {
        lengthInstruction: 'Skriv en saga för 7–8 år: enkel handling, tydliga karaktärer och cirka 400–600 ord.',
        maxTokens: 900
      };
    case '9-10':
      return {
        lengthInstruction: 'Skriv en saga för 9–10 år: mer handling och beskrivningar, cirka 600–900 ord.',
        maxTokens: 1400
      };
    case '11-12':
      return {
        lengthInstruction: 'Skriv en saga för 11–12 år: längre och mer utvecklad intrig, cirka 900–1200 ord.',
        maxTokens: 2000
      };
    case '13-15':
      return {
        lengthInstruction: 'Skriv en saga för 13–15 år: mogen ton för yngre tonåringar, mer komplex handling och utvecklade karaktärer, cirka 1000–1600 ord.',
        maxTokens: 2500
      };
    default:
      return {
        lengthInstruction: 'Skriv en saga anpassad för barn — anpassa längd efter åldern.',
        maxTokens: undefined
      };
  }
}

function json(obj, status = 200, origin = '*') {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin }
  });
}
