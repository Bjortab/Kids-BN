// functions/generate.js
// Ersätter modell‑anropet med robust continuation-logik så sagor inte kapas mitt i.
// - Använder OpenAI Chat Completions endpoint som tidigare.
// - Om svaret trunkeras (finish_reason === 'length' / 'max_tokens' / null), ber vi modellen fortsätta.
// - Begränsar antal fortsättningar för att undvika oändliga loopar.
// - Behåller tidigare trimming för 1-2 åringar.

export async function onRequestPost({ request, env }) {
  const JSON_HEADERS = { "Content-Type": "application/json;charset=utf-8" };
  const origin = request.headers.get('origin') || env.BN_ALLOWED_ORIGIN || '*';

  function okHeaders() {
    return {
      "Content-Type": "application/json;charset=utf-8",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
  }

  // Utility: short JSON response helper
  function jsonBody(obj, status = 200) {
    return new Response(JSON.stringify(obj, null, 2), { status, headers: okHeaders() });
  }

  // Trim helper for the very youngest group (behåll gammal beteende)
  function trimToCharacters(text, maxChars) {
    if (!text || text.length <= maxChars) return text;
    // försök trimma till närmaste mening slutpunkt innan maxChars om möjligt
    const slice = text.slice(0, maxChars);
    const lastDot = Math.max(slice.lastIndexOf('.'), slice.lastIndexOf('!'), slice.lastIndexOf('?'));
    if (lastDot > Math.floor(maxChars * 0.5)) return slice.slice(0, lastDot + 1);
    return slice + '…';
  }

  // Läs body (accepterar JSON)
  let payload = {};
  try {
    payload = await request.json();
  } catch (e) {
    // fallback: tom payload
    payload = {};
  }

  const ageKey = payload.ageRange || payload.age || '3-4';
  const ageGroupRaw = ageKey;
  const kidName = payload.heroName || payload.hero || '';
  const prompt = (payload.prompt || payload.idea || '').trim();

  if (!prompt) {
    return jsonBody({ ok: false, error: 'Missing prompt' }, 400);
  }

  // Modellkonfiguration (kan styras av env)
  const OPENAI_KEY = env.OPENAI_API_KEY;
  const MODEL = env.OPENAI_MODEL || 'gpt-4o-mini';
  // Default max tokens för varje anrop (justera via env om du vill)
  const DEFAULT_MAX_TOKENS = Number(env.MAX_OUTPUT_TOKENS || 1500);
  const TEMPERATURE = Number(env.TEMPERATURE || 0.8);

  if (!OPENAI_KEY) {
    return jsonBody({ ok: false, error: 'Missing OPENAI_API_KEY in environment' }, 500);
  }

  // System- och user-meddelanden
  const lengthInstruction = (() => {
    // Håll texten längre för äldre barn
    const ag = String(ageGroupRaw || '');
    if (ag.includes('1') || ag.includes('2')) return 'Mycket kort saga: 1-2 meningar, mycket enkel. Max 100 tecken.';
    if (ag.includes('3') || ag.includes('4') || ag.includes('5')) return 'Kort saga: 6-12 korta meningar.';
    // äldre barn: längre berättelse
    return 'Skriv en komplett, sammanhängande saga med välutvecklad handling, mellan 10–20 meningar. Avsluta berättelsen naturligt.';
  })();

  const sys = [
    "Du är en trygg och snäll sagoberättare för barn på svenska.",
    lengthInstruction,
    `Åldersgrupp: ${ageGroupRaw}. Anpassa språk och ton efter åldern.`,
    kidName ? `Barnets namn är ${kidName}. Inkludera namnet naturligt i berättelsen.` : "",
    "VIKTIGT: Svara endast med själva berättelsetexten — inga rubriker, inga förklaringar, inga citationstecken. Bara berättelsen."
  ].filter(Boolean).join(' ');

  const user = `Sagaidé: ${prompt}`;

  // Anropa OpenAI Chat Completions API (ej streaming)
  async function callModel(messages, max_tokens = DEFAULT_MAX_TOKENS) {
    const body = {
      model: MODEL,
      messages,
      max_tokens,
      temperature: TEMPERATURE
    };
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, status: res.status, text: t };
    }

    const data = await res.json().catch(() => null);
    if (!data) return { ok: false, status: res.status, text: '<invalid-json>' };
    // Extrahera text och finish_reason
    const choice = (data.choices && data.choices[0]) || {};
    const finish_reason = choice.finish_reason || null;
    // För Chat Completions: innehåll i choice.message.content
    const text = (choice.message && choice.message.content) ? choice.message.content : (choice.text || '');
    return { ok: true, text: String(text || ''), finish_reason, raw: data };
  }

  try {
    const MAX_CONTINUATIONS = 4; // högst antal extra anrop
    let continuations = 0;
    let accumulated = '';

    // Vi skickar den ursprungliga prompten först
    let messages = [
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ];

    while (true) {
      const result = await callModel(messages, DEFAULT_MAX_TOKENS);
      if (!result.ok) {
        return jsonBody({ ok: false, error: 'Model call failed', details: result }, 502);
      }

      // Lägg till output
      const chunk = (result.text || '').trim();
      if (chunk) {
        // Lägg till med en blank rad mellan delarna för läsbarhet
        accumulated = (accumulated + '\n' + chunk).trim();
      }

      // Om finish_reason indikerar truncation, gör en continuation
      const fr = (result.finish_reason || '').toLowerCase();
      if (fr === 'length' || fr === 'max_tokens' || fr === 'content_filter' || result.finish_reason === null) {
        // Om vi redan gjort för många fortsättningar, returnera vad vi har
        if (continuations >= MAX_CONTINUATIONS) {
          return jsonBody({
            ok: true,
            truncated: true,
            story: accumulated,
            note: `Truncated after ${continuations} continuations`,
            raw: result.raw
          }, 200);
        }

        // Bygg en kort continuation-prompt som instruerar modellen att fortsätta där den slutade
        const continueSystem = {
          role: 'system',
          content: 'Fortsätt berättelsen i föregående meddelande och avsluta den på ett naturligt sätt. Fortsätt i samma ton och stil.'
        };

        const continueUser = {
          role: 'user',
          content: `Fortsätt berättelsen. Föregående text:\n\n${accumulated}\n\nFortsätt där det slutade och avsluta berättelsen.`
        };

        // minska context till essensen för att spara tokens
        messages = [{ role: 'system', content: sys }, continueSystem, continueUser ];
        continuations++;
        // loopa igen för att få continuation
        continue;
      } else {
        // Normal avslutning (finish_reason = 'stop' eller liknande)
        // Utför eventuell åldersbaserad trimning
        if (String(ageGroupRaw).includes('1') || String(ageGroupRaw).includes('2')) {
          const trimmed = trimToCharacters(accumulated, 100);
          return jsonBody({ ok: true, story: trimmed }, 200);
        }
        return jsonBody({ ok: true, story: accumulated }, 200);
      }
    }
  } catch (err) {
    return jsonBody({ ok: false, error: String(err), stack: (err?.stack || '').split('\n').slice(0,6) }, 500);
  }
}
