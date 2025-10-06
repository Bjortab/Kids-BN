export async function onRequest(context){
  const { request, env } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if(!id) return new Response("Missing id", { status: 400 });

  const r2 = env["bn-art"];
  if(!r2) return new Response("NO_R2_BINDING", { status: 500 });

  const [job] = id.split("-");
  const key = `variations/${job}/${id}.png`;
  const obj = await r2.get(key);
  if(!obj) return new Response("Not found", { status: 404 });

  const h = new Headers();
  h.set("Content-Type", "image/png");
  h.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { status: 200, headers: h });
}
