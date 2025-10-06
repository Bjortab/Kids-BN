// Hämtar bilder från R2 (bn-art) med prefix
// GET /art?id=<jobId>/<num>.png

export async function onRequestGet({ request, env }) {
  const allow = env.KIDSBN_ALLOWED_ORIGIN || "*";
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return new Response(JSON.stringify({ error: "Missing id" }), {
        status: 400,
        headers: cors(allow),
      });
    }

    const prefix = (env.ART_PREFIX || "art/").replace(/^\/+|\/+$/g, "");
    const key = `${prefix}/${id.replace(/^\/+/, "")}`;

    const obj = await env["bn-art"].get(key);
    if (!obj) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: cors(allow),
      });
    }

    return new Response(obj.body, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
        ...cors(allow),
      },
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
    "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
