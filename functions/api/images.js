// functions/api/images.js
const KEYWORDS = [
  { cat: "dragon",   words: ["drake","drakar","dragon","eld","grotta"] },
  { cat: "bunny",    words: ["kanin","kaniner","hare"] },
  { cat: "princess", words: ["prinsessa","slott","krona","bal"] },
  { cat: "dino",     words: ["dinosaurie","dino","t-rex","triceratops"] },
  { cat: "pirate",   words: ["pirat","pirater","skepp","skatt","kaptens"] },
  { cat: "space",    words: ["rymd","raket","planeter","stjärnor","astronaut"] },
];

function detectCategories(txt, max=2){
  const found = [];
  const t = (txt || "").toLowerCase();
  for (const k of KEYWORDS){
    if (k.words.some(w => t.includes(w))) found.push(k.cat);
  }
  if (!found.length) found.push("dragon");
  return found.slice(0, max);
}
function makeViewUrl(origin, key){
  const enc = encodeURIComponent(key);
  return `${origin}/api/images/view?key=${enc}`;
}
async function readCatalogJSON(env){
  try{
    const obj = await env.BN_IMAGES.get("images/catalog.json");
    if (!obj) return null;
    const txt = await obj.text();
    return JSON.parse(txt);
  }catch{ return null; }
}
async function listUnderPrefix(env, prefix, limit=50){
  const out = [];
  let cursor;
  do{
    const res = await env.BN_IMAGES.list({ prefix, cursor, limit });
    for (const it of res.objects || []){
      if (!it.key.endsWith("/")) out.push(it.key);
    }
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor && out.length < limit);
  return out;
}

export async function onRequestGet(ctx){
  const { request, env } = ctx;
  const url = new URL(request.url);

  if (url.pathname.endsWith("/images/view")){
    const key = url.searchParams.get("key");
    if (!key) return new Response("Missing key", { status: 400 });
    const obj = await env.BN_IMAGES.get(key);
    if (!obj) return new Response("Not found", { status: 404 });

    let type = "image/png";
    if (key.endsWith(".jpg") || key.endsWith(".jpeg")) type = "image/jpeg";
    else if (key.endsWith(".webp")) type = "image/webp";
    else if (key.endsWith(".gif")) type = "image/gif";
    else if (key.endsWith(".mp4")) type = "video/mp4";

    return new Response(obj.body, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=31536000, immutable",
      }
    });
  }

  const storyText = url.searchParams.get("storyText") || "";
  const count = Math.max(1, Math.min(6, parseInt(url.searchParams.get("count") || "3",10)));
  const origin = url.origin;

  const catalog = await readCatalogJSON(env);
  const cats = detectCategories(storyText, 2);

  const chosen = [];
  for (const cat of cats){
    if (catalog?.categories?.[cat]?.items?.length){
      const pool = catalog.categories[cat].items.slice().sort(()=>Math.random()-0.5);
      for (const item of pool){
        if (chosen.length >= count) break;
        const fname = item.file.replace(/^images\//,'').replace(/^.*\//,'');
        const key = `images/${cat}/${fname}`;
        chosen.push({ category: cat, key, url: makeViewUrl(origin, key), tags: item.tags || [] });
      }
    } else {
      const keys = (await listUnderPrefix(env, `images/${cat}/`, 50)).sort(()=>Math.random()-0.5);
      for (const key of keys){
        if (chosen.length >= count) break;
        chosen.push({ category: cat, key, url: makeViewUrl(origin, key), tags: [] });
      }
    }
    if (chosen.length >= count) break;
  }

  return Response.json({ ok:true, images: chosen });
}

export async function onRequestPost(ctx){
  const { request } = ctx;
  let body = {};
  try { body = await request.json(); } catch {}
  const url = new URL(request.url);
  const qs = new URLSearchParams();
  if (body.storyText) qs.set("storyText", body.storyText);
  if (body.ageRange)  qs.set("ageRange", body.ageRange);
  if (body.count)     qs.set("count", String(body.count));
  return Response.redirect(`${url.origin}/api/images?${qs.toString()}`, 307);
}
