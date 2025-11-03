// Robust Pages Function endpoint för att generera berättelser.
// Hanterar OPTIONS (CORS), GET (diagnostik) och POST (generera).
// Returnerar alltid Content-Type: application/json så frontend inte försöker parsa HTML.

export async function onRequest(context) {
  const { request } = context;

  const defaultHeaders = {
    'Content-Type': 'application/json;charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  try {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: defaultHeaders
      });
    }

    // Hjälp‑response för GET så man enkelt kan kontrollera endpointen i browser
    if (request.method === 'GET') {
      const info = {
        ok: true,
        message: 'generate_story endpoint — använd POST med JSON body: { ageRange, heroName, prompt }',
        path: '/api/generate_story',
        note: 'Returns JSON; make sure frontend POSTs to the exact path and sets Content-Type: application/json'
      };
      return new Response(JSON.stringify(info), { status: 200, headers: defaultHeaders });
    }

    // Förväntar oss POST för riktig generering
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ ok: false, error: `Unsupported method ${request.method}` }), {
        status: 405,
        headers: defaultHeaders
      });
    }

    // Läs body säkert (kan vara tom, JSON eller formdata)
    const bodyText = await request.text();
    let payload = {};
    if (bodyText) {
      try {
        payload = JSON.parse(bodyText);
      } catch (err) {
        // försök som urlencoded / fallback
        try {
          const params = new URLSearchParams(bodyText);
          for (const [k, v] of params) payload[k] = v;
        } catch (e) {
          payload = {};
        }
      }
    }

    const age = payload.age ?? payload.ageRange ?? payload.ageGroup ?? 0;
    const brief = payload.prompt ?? payload.brief ?? payload.topic ?? 'En kort berättelse';

    // Enkel ordlängds‑mapping (kan justeras senare)
    const AGE_LENGTH_MAP = {
      '1-2': { min: 40,  max: 120 },
      '3-4': { min: 120, max: 260 },
      '5-7': { min: 260, max: 450 },
      '8-10':{ min: 450, max: 700 },
      '11-12':{ min: 800, max: 1200 }
    };

    function getCategoryForAge(a) {
      const n = Number(String(a).replace(/[^\d]/g, '')) || 0;
      if (n <= 2) return '1-2';
      if (n <= 4) return '3-4';
      if (n <= 7) return '5-7';
      if (n <= 10) return '8-10';
      return '11-12';
    }

    const category = getCategoryForAge(age);
    const { min, max } = AGE_LENGTH_MAP[category] || AGE_LENGTH_MAP['5-7'];
    const targetWords = Math.floor((min + max) / 2);

    // Placeholder‑generation (byt ut mot riktig modellanrop senare)
    const word = "berättelseord";
    const wordsArray = new Array(targetWords).fill(word);
    const generatedText = wordsArray.join(' ');

    const result = {
      ok: true,
      category,
      age,
      brief,
      targetWords,
      story: generatedText
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: defaultHeaders
    });

  } catch (err) {
    // Alltid returnera JSON – undvik HTML‑error som frontend försöker parsa
    const errBody = { ok: false, error: String(err), stack: err?.stack?.split('\n')?.slice(0,5) };
    return new Response(JSON.stringify(errBody), {
      status: 500,
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
