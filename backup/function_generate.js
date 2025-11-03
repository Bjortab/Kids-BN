// functions/generate.js
// Pages Function: POST /api/generate
// Åldersanpassad längd: 1-2 år => max 80-100 tecken (characters).
// Byt inte namn på filen — Pages mappar functions/<name>.js -> /api/<name>

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
    const ageGroupRaw = (body?.ageGroup || body?.ageRange || '3-4 år').trim();

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
    // Server-side safety truncation for 1-2 year olds
    if (ageKey === '1-2') {
      const trimmed = trimToCharacters(storyRaw, 100);
      return json({ story: trimmed }, 200, origin);
    }
    return json({ story: storyRaw }, 200, origin);
  } catch (e) {
    return json({ error: e?.message || 'Serverfel' }, 500, env.KIDSBN_ALLOWED_ORIGIN || '*');
  }
}

function normalizeAge(raw) {
  const s = (raw || '').toLowerCase();
  if (s.includes('1-2') || s.includes('1–2') || s.includes('1 2') || s.includes('1-2 år')) return '1-2';
  if (s.includes('3-4') || s.includes('3–4')) return '3-4';
  if (s.includes('5-6') || s.includes('5–6')) return '5-6';
  if (s.includes('7-8') || s.includes('7–8')) return '7-8';
  if (s.includes('9-10') || s.includes('9–10')) return '9-10';
  if (s.includes('11-12') || s.includes('11–12')) return '11-12';
  return '3-4';
}

function getLengthInstructionAndTokens(ageKey) {
  // Returnerar textinstruktion + rekommenderat max_tokens
  switch (ageKey) {
    case '1-2':
      // Mycket kort: 80-100 tecken — vi begränsar modellen hårt med max_tokens ~ 60
      return {
        lengthInstruction: 'Skriv en mycket kort, enkel och konkret saga på svenska — MAX 100 TECKEN (characters). Endast enkla ord och korta meningar.',
        maxTokens: 60
      };
    case '3-4':
      return {
        lengthInstruction: 'Skriv en kort saga på svenska, enkel men komplett — ungefär 120–180 ord. Använd korta meningar.',
        maxTokens: 220
      };
    case '5-6':
      return {
        lengthInstruction: 'Skriv en saga för 5–6 år — ungefär 250–400 ord.',
        maxTokens: 600
      };
    case '7-8':
      return {
        lengthInstruction: 'Skriv en saga för 7–8 år — ungefär 400–600 ord.',
        maxTokens: 900
      };
    case '9-10':
      return {
        lengthInstruction: 'Skriv en saga för 9–10 år — ungefär 600–900 ord.',
        maxTokens: 1400
      };
    case '11-12':
      return {
        lengthInstruction: 'Skriv en saga för 11–12 år — ungefär 900–1200 ord.',
        maxTokens: 2000
      };
    default:
      return {
        lengthInstruction: 'Skriv en saga anpassad för barn — anpassa längd efter åldern.',
        maxTokens: undefined
      };
  }
}

function trimToCharacters(text, maxChars) {
  if (!text) return text;
  if (text.length <= maxChars) return text;
  const candidate = text.slice(0, maxChars);
  const lastDot = candidate.lastIndexOf('.');
  if (lastDot > Math.floor(maxChars * 0.5)) return candidate.slice(0, lastDot + 1);
  return candidate.trim().slice(0, Math.max(0, maxChars - 1)) + '…';
}

function json(obj, status = 200, origin = '*') {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin }
  });
}
