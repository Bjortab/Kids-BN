export async function onRequestGet({ request, env }) {
  const allow = env.KIDSBN_ALLOWED_ORIGIN || "*";
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("id"); // här skickar vi "key" i frontend, id==key
    if (!key) return new Response("Missing id", { status:400, headers: cors(allow) });

    const obj = await env["bn-art"].get(key);
    if (!obj) return new Response("Not found", { status:404, headers: cors(allow) });

    return new Response(obj.body, { status:200, headers:{ "Content-Type":"image/png", "Cache-Control":"public, max-age=31536000, immutable", ...cors(allow) } });
  } catch (e) {
    return new Response("Server error", { status:500, headers: cors(allow) });
  }
}
function cors(origin){
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
