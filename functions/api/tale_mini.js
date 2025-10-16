// /functions/api/tale_mini.js
// Minimal, robust sagogenerator med tydlig felhantering.
// Läser ENV:
//   PROVIDER = "anthropic" | "openrouter"
//   MODEL_CLAUDE = "claude-3-5-sonnet"  (Anthropic direkt)  ELLER
//                  "anthropic/claude-3.5-sonnet" (OpenRouter)
//   LANG_DEFAULT = "sv"
//   OPENROUTER_API_KEY (om PROVIDER=openrouter)
//   ANTHROPIC_API_KEY  (om PROVIDER=anthropic)

function okHeaders(origin = "*") {
  return {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization",
    "cache-control": "no-store"
  };
}

export async function onRequest({ request, env }) {
  const origin = "*";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: okHeaders(origin) });
  }

  try {
    let body = {};
    try {
      body = request.method === "POST" ? await request.json() : {};
    } catch {
      // tillåt även query ?q=...
      const url = new URL(request.url);
      body.q = body.q || url.searchParams.get("q");
    }

    const topic = (body.q || body.topic || body.prompt || "").toString().trim();
    const lang = (env.LANG_DEFAULT || body.lang || "sv").toString();

    if (!topic) {
      return new Response(JSON.stringify({ error: "Missing prompt/topic (body.q)" }, null, 2),
        { status: 400, headers: okHeaders(origin) });
    }

    const provider = (env.PROVIDER || "").toLowerCase(); // "anthropic" eller "openrouter"
    const modelRaw = env.MODEL_CLAUDE || "";

    // Bygg en enkel, säker prompt på svenska
    const system = `Du är en skicklig svensk barnboksförfattare. Skriv en varm, trygg och fantasifull barnberättelse på ${lang}. 
- Språk: mycket tydlig svenska för barn.
- Längd: 10–14 korta meningar.
- Undvik våld och läskiga detaljer.
- Ge berättelsen en mild sensmoral i slutet.`;

    const user = `Skriv en saga om: ${topic}`;

    let storyText = "";

    if (provider === "anthropic") {
      // Anthropic direkt
      const model = modelRaw || "claude-3-5-sonnet";
      const apiKey = env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({ error: "Missing ANTHROPIC_API_KEY" }, null, 2),
          { status: 500, headers: okHeaders(origin) });
      }

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          // Den här versions-headern krävs av Anthropic
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model,
          max_tokens: 1200,
          system,
          messages: [{ role: "user", content: user }]
        })
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        return new Response(JSON.stringify({
          error: "Anthropic API error",
          status: resp.status,
          model,
          body: safeParse(errText)
        }, null, 2), { status: 502, headers: okHeaders(origin) });
      }

      const data = await resp.json();
      // Claude messages svarar med content[].text
      storyText = data?.content?.[0]?.text || "";
    } else if (provider === "openrouter") {
      // OpenRouter (OpenAI-kompatibelt schema)
      // Modellnamnform: "anthropic/claude-3.5-sonnet"
      const model = modelRaw || "anthropic/claude-3.5-sonnet";
      const apiKey = env.OPENROUTER_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({ error: "Missing OPENROUTER_API_KEY" }, null, 2),
          { status: 500, headers: okHeaders(origin) });
      }

      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${apiKey}`,
          // valfria men bra för OpenRouter-etikett
          "HTTP-Referer": "https://kids-bn.pages.dev",
          "X-Title": "BN Kids"
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ],
          max_tokens: 1200
        })
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        return new Response(JSON.stringify({
          error: "OpenRouter API error",
          status: resp.status,
          model,
          body: safeParse(errText)
        }, null, 2), { status: 502, headers: okHeaders(origin) });
      }

      const data = await resp.json();
      storyText = data?.choices?.[0]?.message?.content || "";
    } else {
      return new Response(JSON.stringify({
        error: "Unsupported PROVIDER. Set env.PROVIDER to 'anthropic' or 'openrouter'.",
        provider
      }, null, 2), { status: 500, headers: okHeaders(origin) });
    }

    if (!storyText) {
      return new Response(JSON.stringify({ error: "Empty story from model" }, null, 2),
        { status: 502, headers: okHeaders(origin) });
    }

    return new Response(JSON.stringify({ ok: true, story: storyText }, null, 2),
      { status: 200, headers: okHeaders(origin) });

  } catch (err) {
    return new Response(JSON.stringify({
      error: String(err?.message || err),
      stack: err?.stack || null
    }, null, 2), { status: 500, headers: okHeaders() });
  }
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return text; }
}
