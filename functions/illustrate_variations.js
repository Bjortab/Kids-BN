export async function onRequestOptions({ env }) {
  return new Response(null, { status: 204, headers: cors(env.KIDSBN_ALLOWED_ORIGIN || "*") });
}

export async function onRequestPost({ request, env }) {
  const allow = env.KIDSBN_ALLOWED_ORIGIN || "*";
  try {
    const { prompt, count = 4 } = await request.json();
    if (!prompt || !prompt.trim()) return json({ error: "Missing prompt" }, 400, allow);
    if (!env.OPENAI_API_KEY)       return json({ error: "OPENAI_API_KEY saknas." }, 500, allow);

    const n = Math.min(Math.max(1, Number(count)||4), 4);
    const items = [];

    for (let i=0;i<n;i++){
      const imgRes = await fetch("https://api.openai.com/v1/images/generations", {
        method:"POST",
        headers:{ "Authorization":`Bearer ${env.OPENAI_API_KEY}`, "Content-Type":"application/json" },
        body: JSON.stringify({
          model: "gpt-image-1",
          prompt: `Barnvänlig illustration, mjuka färger, sagostil, utan text. Motiv: ${prompt}`,
          size: "1024x1024"
        })
      });
      if (!imgRes.ok) {
        const t = await imgRes.text().catch(()=> "");
        return json({ error: "Image error", details: t }, 502, allow);
      }
      const data = await imgRes.json();
      const b64 = data?.data?.[0]?.b64_json;
      if (!b64) continue;

      const id = crypto.randomUUID();
      const key = `${(env.IMAGE_PREFIX || "kids/art").replace(/^\/+|\/+$/g,"")}/${id}.png`;
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));

      await env["bn-art"].put(key, new Blob([bin], { type:"image/png" }), { httpMetadata:{ contentType:"image/png" } });
      items.push({ id, key });
    }

    return json({ items }, 200, allow);
  } catch (e) {
    return json({ error: e?.message || "Serverfel" }, 500, allow);
  }
}

function cors(origin){
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
function json(obj, status, origin){
  return new Response(JSON.stringify(obj), { status, headers:{ "Content-Type":"application/json", ...cors(origin) } });
}
function atob(b64){return globalThis.atob ? globalThis.atob(b64) : Buffer.from(b64,'base64').toString('binary');}
