// Skapar N bildvarianter och sparar i R2 med ART_PREFIX
// POST /illustrate_variations  { hero_desc, n? } -> { job_id, variations:[{id,url}] }

export async function onRequestPost({ request, env }) {
  const allow = env.KIDSBN_ALLOWED_ORIGIN || "*";

  try {
    if (!env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "Image gen disabled" }), {
        status: 501,
        headers: cors(allow),
      });
    }

    const { hero_desc, n } = await request.json();
    if (!hero_desc || !hero_desc.trim()) {
      return new Response(JSON.stringify({ error: "Missing hero_desc" }), {
        status: 400,
        headers: cors(allow),
      });
    }
    const count = Math.min(Math.max(Number(n) || 4, 1), 4);

    const jobId = crypto.randomUUID();
    const prefix = (env.ART_PREFIX || "art/").replace(/^\/+|\/+$/g, "");
    const baseKey = `${prefix}/${jobId}`;

    // Prompt till OpenAI Images
    const prompt = [
      "Barnvänlig illustration.",
      "Akvarellkänsla, mjuka färger, vänligt ansikte.",
      "Ingen text, inga vattenstämplar.",
      `Motiv: ${hero_desc.slice(0, 300)}.`,
    ].join(" ");

    const variations = [];
    for (let i = 0; i < count; i++) {
      const imgRes = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-image-1",
          prompt,
          size: "1024x1024",
          n: 1,
          // background: "transparent" // valfritt, offrar kvalitet ibland
        }),
      });

      if (!imgRes.ok) {
        const t = await imgRes.text().catch(() => "");
        return new Response(
          JSON.stringify({ error: "Image API failed", details: t }),
          { status: 502, headers: cors(allow) }
        );
      }

      const data = await imgRes.json();
      const b64 = data.data?.[0]?.b64_json;
      if (!b64) {
        return new Response(JSON.stringify({ error: "No image data" }), {
          status: 500,
          headers: cors(allow),
        });
      }
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

      const key = `${baseKey}/${i + 1}.png`;
      await env["bn-art"].put(key, bytes, {
        httpMetadata: { contentType: "image/png" },
      });

      // Appen hämtar via /art?id=<jobId>/<i+1>.png
      const id = `${jobId}/${i + 1}.png`;
      const url = `${originOf(env)}/art?id=${encodeURIComponent(id)}`;
      variations.push({ id, url });
    }

    return new Response(JSON.stringify({ job_id: jobId, variations }), {
      status: 200,
      headers: cors(allow),
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "Server error" }), {
      status: 500,
      headers: cors(allow),
    });
  }
}

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function originOf(env) {
  // För Pages ligger request-origin i runtime, men vi kan falla tillbaka på miljövariabel
  return env.MERCH_BASE_URL || "";
}
