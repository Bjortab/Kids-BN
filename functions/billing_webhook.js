export async function onRequest(context){
  const { request, env } = context;
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Stripe-Signature, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers });

  const entKV = env.kidsbn_entitlements;
  const raw = await request.text();
  let event;
  try{ event = JSON.parse(raw); }catch{ return new Response(JSON.stringify({ error:"BAD_JSON" }), { status:400, headers }); }

  async function addTokens(userId, n){
    const key = `ent:${userId}`;
    const ent = (await entKV.get(key, "json")) || { plan:"free", tokens_left:0, monthly_quota:8, status:"active" };
    ent.tokens_left = (ent.tokens_left || 0) + n;
    await entKV.put(key, JSON.stringify(ent));
  }
  async function setSub(userId, plan, months=1){
    const key = `ent:${userId}`;
    const ent = (await entKV.get(key, "json")) || {};
    const now = new Date(); const renews = new Date(now); renews.setMonth(renews.getMonth()+months);
    Object.assign(ent, { plan, status:"active", monthly_quota: plan==="plus" ? 100 : 30, renews_at: renews.toISOString() });
    await entKV.put(key, JSON.stringify(ent));
  }

  try{
    const type = event.type;
    if(type === "checkout.session.completed"){
      const sess = event.data.object;
      const userId = sess.client_reference_id || sess.metadata?.user_id;
      const mode = sess.mode; // "payment"/"subscription"
      if(userId){
        if(mode==="payment"){ await addTokens(userId, 20); }
        else { await setSub(userId, "plus", 1); }
      }
    } else if(type === "invoice.paid"){
      const inv = event.data.object;
      const userId = inv.metadata?.user_id || inv.customer_email && `email:${inv.customer_email}`;
      if(userId) await setSub(userId, "plus", 1);
    }
  }catch(e){
    return new Response(JSON.stringify({ ok:false, error:String(e) }), { status:500, headers });
  }

  return new Response(JSON.stringify({ ok:true }), { status:200, headers });
}
