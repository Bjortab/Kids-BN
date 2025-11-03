// functions/api/generate_story.js
// Proxy/adapter för frontend: POST -> /api/generate
// Denna implementation skickar vidare till interna /api/generate (som använder modeller)
// och returnerar alltid JSON med rätt headers. Finns fallback till enkel placeholder
// om interna anropet skulle misslyckas.

export async function onRequest(context) {
  const { request, env } = context;

  const defaultHeaders = {
    'Content-Type': 'application/json;charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  try {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: defaultHeaders });
    }

    // Hjälpinfo för GET
    if (request.method === 'GET') {
      const info = {
        ok: true,
        message: 'generate_story endpoint — använd POST med JSON body: { ageRange, heroName, prompt }',
        path: '/api/generate_story',
        note: 'This endpoint proxies to /api/generate which performs the model call.'
      };
      return new Response(JSON.stringify(info), { status: 200, headers: defaultHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ ok: false, error: `Unsupported method ${request.method}` }), {
        status: 405,
        headers: defaultHeaders
      });
    }

    // Läs och tolka body
    const bodyText = await request.text();
    let payload = {};
    if (bodyText) {
      try {
        payload = JSON.parse(bodyText);
      } catch (err) {
        // försök som urlencoded
        try {
          const params = new URLSearchParams(bodyText);
          for (const [k, v] of params) payload[k] = v;
        } catch (e) {
          payload = {};
        }
      }
    }

    // Skicka vidare till interna generate endpoint som gör modell‑anrop
    try {
      const forwardRes = await fetch(new URL('/api/generate', request.url).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const text = await forwardRes.text().catch(() => '');

      // Försäkra oss om att vi returnerar JSON med rätt headers
      if (!forwardRes.ok) {
        // Returnera body för debugging men med 502-status
        return new Response(text || JSON.stringify({ ok: false, error: `Upstream failed with ${forwardRes.status}` }), {
          status: 502,
          headers: defaultHeaders
        });
      }

      // Om upstream svarar med JSON, returnera den precis som den är
      // (antingen text innehåll som JSON eller redan JSON)
      // Vi försöker parse för att säkerställa content-type
      try {
        const parsed = JSON.parse(text || '{}');
        return new Response(JSON.stringify(parsed), { status: 200, headers: defaultHeaders });
      } catch (e) {
        // Om upstream skickade text/plain, wrappa det i JSON
        return new Response(JSON.stringify({ ok: true, story: String(text || '') }), {
          status: 200,
          headers: defaultHeaders
        });
      }
    } catch (forwardErr) {
      // Om proxyn misslyckas — fallback: generera enkel placeholder men var tydlig
      console.error('[generate_story] forward error', forwardErr);
      const word = "berättelseord";
      const age = payload.age ?? payload.ageRange ?? 'okänd';
      const brief = String(payload.prompt || payload.brief || 'En kort berättelse').slice(0,200);
      const fallback = Array(120).fill(word).join(' ');
      const result = {
        ok: false,
        error: 'Upstream generate call failed',
        upstreamError: String(forwardErr),
        note: 'Detta är en fallback placeholder. Åtgärda upstream /api/generate för riktiga berättelser.',
        age,
        brief,
        story: fallback
      };
      return new Response(JSON.stringify(result), { status: 502, headers: defaultHeaders });
    }

  } catch (err) {
    const errBody = { ok: false, error: String(err), stack: err?.stack?.split('\n')?.slice(0,5) };
    return new Response(JSON.stringify(errBody), {
      status: 500,
      headers: defaultHeaders
    });
  }
}
