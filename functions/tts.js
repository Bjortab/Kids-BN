// functions/tts.js
const cors = (origin) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
});

export async function onRequestOptions(ctx) {
  const origin = ctx.env?.BN_ALLOWED_ORIGIN || '*';
  return new Response(null, { status: 204, headers: cors(origin) });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const origin = env?.BN_ALLOWED_ORIGIN || '*';

  try {
    const apiKey = env?.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'OPENAI_API_KEY saknas' }), {
        status: 500,
        headers: { ...cors(origin), 'Content-Type': 'application/json' }
      });
    }

    const { text, voice = 'alloy', format = 'mp3', speed = 1.0 } = await request.json();
    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'text måste skickas i body' }), {
        status: 400,
        headers: { ...cors(origin), 'Content-Type': 'application/json' }
      });
    }

    // Begränsa storleken lite för säkerhet
    if (text.length > 12000) {
      return new Response(JSON.stringify({ error: 'Texten är för lång för TTS (max ca 12k tecken)' }), {
        status: 413,
        headers: { ...cors(origin), 'Content-Type': 'application/json' }
      });
    }

    const model = env?.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';

    const upstream = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        voice,          // t.ex. 'alloy'
        input: text,    // TTS-texten
        format,         // 'mp3' (returnerar audio/mpeg)
        speed           // 1.0 normal
      })
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      return new Response(JSON.stringify({ error: `OpenAI TTS fel: ${upstream.status} ${errText}` }), {
        status: 500,
        headers: { ...cors(origin), 'Content-Type': 'application/json' }
      });
    }

    // Streama ljudet direkt tillbaka
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...cors(origin),
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { ...cors(origin), 'Content-Type': 'application/json' }
    });
  }
}
