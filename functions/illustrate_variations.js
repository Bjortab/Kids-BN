export async function onRequest(context){
  const { request, env } = context;
  const headers = {
    "Access-Control-Allow-Origin": env.KIDSBN_ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers });

  const body = await request.json().catch(()=> ({}));
  const heroDesc = (body.hero_desc||"En snäll blå drake i akvarellstil, mjuka färger, barnvänlig, leende.").toString().slice(0,300);
  const n = Math.max(1, Math.min(6, Number(body.n)||4));

  const r2 = env["bn-art"];
  if(!r2) return new Response(JSON.stringify({ error:"NO_R2_BINDING" }), { status:500, headers });

  const jobId = crypto.randomUUID();
  const basePrompt = `Illustration av barnbokskaraktär: ${heroDesc}. Stil: akvarell, mjuka pastellfärger, mild belysning, inga hårda skuggor, stora vänliga ögon. Vit bakgrund, centrerad figur.`;

  const variations = [];
  for(let i=0;i<n;i++){
    const imgRes = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1", prompt: basePrompt + ` Variation ${i+1}: lite annorlunda pose.`, size: "1024x1024" })
    });
    if(!imgRes.ok){ const t=await imgRes.text().catch(()=>"(no text)"); return new Response(JSON.stringify({ error:"IMAGE_UPSTREAM", detail:t }), { status:502, headers }); }
    const imgData = await imgRes.json();
    const b64 = imgData?.data?.[0]?.b64_json;
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));

    const id = `${jobId}-${i+1}`;
    const key = `variations/${jobId}/${id}.png`;
    await r2.put(key, bytes, { httpMetadata:{ contentType:"image/png", cacheControl:"public, max-age=31536000" } });
    variations.push({ id, key });
  }

  await env.kidsbn_merch_jobs.put(`job:${jobId}`, JSON.stringify({ ids: variations.map(v=>v.id) }), { expirationTtl: 60*60*24*7 });

  const base = env.MERCH_BASE_URL || new URL(request.url).origin;
  const out = variations.map(v => ({ id: v.id, url: `${base}/art?id=${encodeURIComponent(v.id)}` }));

  return new Response(JSON.stringify({ job_id: jobId, variations: out }), { status: 200, headers });
}

function atob(b64){ return Buffer.from(b64, "base64").toString("binary"); }
