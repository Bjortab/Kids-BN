export async function onRequest(context){
  const { request, env } = context;
  const headers = {
    "Access-Control-Allow-Origin": env.BN_ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers });

  const body = await request.json().catch(()=> ({}));
  const jobId = (body.job_id||"").toString();
  const varId = (body.variation_id||"").toString();
  const product = body.product || { type:"tshirt", color:"white", size:"M" };

  const job = await env.kidsbn_merch_jobs.get(`job:${jobId}`, "json");
  if(!job || !Array.isArray(job.ids) || !job.ids.includes(varId)){
    return new Response(JSON.stringify({ error: "INVALID_VARIATION" }), { status: 400, headers });
  }

  const base = env.MERCH_BASE_URL || new URL(request.url).origin;
  const imageUrl = `${base}/art?id=${encodeURIComponent(varId)}`;

  // Mock-checkout – byt till Printful/Printify när du vill gå live
  const checkout = `${base}/mock-checkout?img=${encodeURIComponent(imageUrl)}&type=${product.type}&color=${product.color}&size=${product.size}`;
  return new Response(JSON.stringify({ checkout_url: checkout }), { status: 200, headers });
}
