// Enkel test‑funktion för Pages Functions
// Placera denna fil i functions/api/generate_story.js i repo och merg­a/pusha till main.
// Den förväntar sig en POST med JSON body: { "age": 3, "brief": "en räv i skogen" }
// Svarar alltid med giltig JSON så frontend inte försöker parsa HTML/404.

export async function onRequest(context) {
  try {
    const { request } = context;
    // Tillåt preflight / CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    const bodyText = await request.text();
    let payload = {};
    try {
      payload = bodyText ? JSON.parse(bodyText) : {};
    } catch (e) {
      // Om klient skickar form data eller tomt, hantera försiktigt
      payload = {};
    }

    const age = payload.age ?? payload.ageGroup ?? 0;
    const brief = payload.brief ?? payload.topic ?? 'En kort berättelse';

    // Enkel mapping av ordlängd per kategori (samma idé som vi diskuterade)
    const AGE_LENGTH_MAP = {
      '1-2': { min: 40,  max: 120 },
      '3-4': { min: 120, max: 260 },
      '5-7': { min: 260, max: 450 },
      '8-10':{ min: 450, max: 700 },
      '11-12':{ min: 800, max: 1200 }
    };

    function getCategoryForAge(a) {
      const n = Number(a) || 0;
      if (n <= 2) return '1-2';
      if (n <= 4) return '3-4';
      if (n <= 7) return '5-7';
      if (n <= 10) return '8-10';
      return '11-12';
    }

    const category = getCategoryForAge(age);
    const { min, max } = AGE_LENGTH_MAP[category] || AGE_LENGTH_MAP['5-7'];
    // En enkel target (mitt i intervallet)
    const targetWords = Math.floor((min + max) / 2);

    // Generera en placeholder‑text med ungefär targetWords ord (bara för test)
    const word = "berättelseord";
    const wordsArray = new Array(targetWords).fill(word);
    const generatedText = wordsArray.join(' ');

    const result = {
      ok: true,
      category,
      age,
      brief,
      targetWords,
      text: generatedText
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    const errBody = { ok: false, error: String(err) };
    return new Response(JSON.stringify(errBody), {
      status: 500,
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
