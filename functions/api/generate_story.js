/* functions/api/generate_story.js — proxy till /generate */
export async function onRequest(context) {
  const { request } = context;

  const defaultHeaders = {
    'Content-Type': 'application/json;charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: defaultHeaders });
    }

    if (request.method === 'GET') {
      const info = {
        ok: true,
        message: 'generate_story endpoint — använd POST med JSON body: { ageRange, heroName, prompt }',
        path: '/api/generate_story',
        note: 'This endpoint proxies the request to /generate which performs the model call.'
      };
      return new Response(JSON.stringify(info), { status: 200, headers: defaultHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ ok: false, error: `Unsupported method ${request.method}` }), {
        status: 405,
        headers: defaultHeaders
      });
    }

    const bodyText = await request.text();
    let payload = {};
    if (bodyText) {
      try {
        payload = JSON.parse(bodyText);
      } catch (err) {
        try {
          const params = new URLSearchParams(bodyText);
          for (const [k, v] of params) payload[k] = v;
        } catch (e) {
          payload = {};
        }
      }
    }

    const target = new URL('/generate', request.url).toString();
    try {
      const forwardRes = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const text = await forwardRes.text().catch(() => '');

      if (!forwardRes.ok) {
        return new Response(text || JSON.stringify({ ok: false, error: `Upstream failed with ${forwardRes.status}` }), {
          status: 502,
          headers: defaultHeaders
        });
      }

      try {
        const parsed = JSON.parse(text || '{}');
        return new Response(JSON.stringify(parsed), { status: 200, headers: defaultHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ ok: true, story: String(text || '') }), {
          status: 200,
          headers: defaultHeaders
        });
      }
    } catch (forwardErr) {
      console.error('[generate_story] forward error', forwardErr);
      const word = "berättelseord";
      const fallback = Array(120).fill(word).join(' ');
      const result = {
        ok: false,
        error: 'Upstream generate call failed',
        upstreamError: String(forwardErr),
        note: 'Detta är en fallback placeholder. Åtgärda upstream /generate för riktiga berättelser.',
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
