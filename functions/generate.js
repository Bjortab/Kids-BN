// functions/generate.js
// Pages Function: POST /api/generate
// Tar emot JSON: { prompt, kidName, ageGroup }
// Kräver: OPENAI_API_KEY i Pages Variables & Secrets
// Åldersanpassad längd: 1-2 år => 80-100 tecken (characters)

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
    const kidName = (body?.kidName || 'Vännen').trim();
    const ageGroupRaw = (body?.ageGroup || body?.ageRange || '3-4 år').trim();

    if (!prompt) return json({ error: 'Skriv vad sagan ska handla om.' }, 400, origin);
    if (!env.OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY saknas.' }, 500, origin);

    // Normalisera ålderssträng till en nyckel vi förstår
    const ageKey = normalizeAge(ageGroupRaw);

    // Längdmappning: för 1-2 år använder vi tecken (characters)
    const lengthInstruction = getLengthInstruction(ageKey);

    // System prompt (svenska) med explicit längdkrav
    const sys = [
      "Du är en trygg och snäll sagoberättare för barn på svenska.",
      lengthInstruction,
      `Åldersgrupp: ${ageGroupRaw}. Anpassa språk och ton efter åldern.`,
      `Barnets namn är ${kidName}. Inkludera namnet naturligt i berättelsen.`,
      "Var varm och trygg i tonen. Inga skrämmande moment eller våld. Avsluta lugnt och hoppfullt."
    ].join(' ');

    // Anropa OpenAI Chat Completions
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.8,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: `Sagaidé: ${prompt}` }
        ],
        max_tokens: env.MAX_TOKENS ? Number(env.MAX_TOKENS) : undefined
      })
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return json({ error: 'OpenAI fel', details: t }, 502, origin);
    }

    const data = await res.json();
    const story = data?.choices?.[0]?.message?.content?.trim();
    if (!story) return json({ error: 'Tomt svar från modell.' }, 502, origin);

    // För 1-2 år: säkerställ att svaret inte är längre än ~100 tecken.
    if (ageKey === '1-2') {
      // Om modellen av någon anledning returnerar längre text, trunkera försiktigt
      const trimmed = trimToCharacters(story, 100);
      return json({ story: trimmed }, 200, origin);
    }

    return json({ story }, 200, origin);
  } catch (e) {
    return json({ error: e?.message || 'Serverfel' }, 500, env.KIDSBN_ALLOWED_ORIGIN || '*');
  }
}

// Hjälpfunktioner

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

function getLengthInstruction(ageKey) {
  // Åldersanpassade instruktioner (svenska)
  switch (ageKey) {
    case '1-2':
      // Mycket kort: 80-100 tecken (characters)
      return 'Skriv en mycket kort, enkel och konkret saga på svenska — ca 80–100 tecken (characters), enkel mening, lätt att förstå för ett litet barn.';
    case '3-4':
      // Kortare sagor, enkla meningar
      return 'Skriv en kort saga på svenska, enkel men komplett — ungefär 120–180 ord. Enkel men levande ton, korta meningar.';
    case '5-6':
      return 'Skriv en saga på svenska för barn 5–6 år — ungefär 250–400 ord, tydlig handling och enkelt språk.';
    case '7-8':
      return 'Skriv en saga på svenska för barn 7–8 år — ungefär 400–600 ord, något mer detaljerad handling och dialog.';
    case '9-10':
      return 'Skriv en saga på svenska för barn 9–10 år — ungefär 600–900 ord, utvecklad handling och karaktärsdrag.';
    case '11-12':
      return 'Skriv en saga för 11–12 år — ungefär 900–1200 ord, mer komplex handling men lämpligt språk för barn.';
    default:
      return 'Skriv en saga anpassad för barn — ungefär 350–800 ord beroende på ålder.';
  }
}

function trimToCharacters(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  // Försök trimma till närmaste mening (punkt) innan maxChars, annars trunkera med ellipsis
  const candidate = text.slice(0, maxChars);
  const lastDot = candidate.lastIndexOf('.');
  if (lastDot > Math.floor(maxChars * 0.5)) {
    return candidate.slice(0, lastDot + 1);
  }
  return candidate.trim().slice(0, Math.max(0, maxChars - 1)) + '…';
}

function json(obj, status = 200, origin = '*') {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin }
  });
}
