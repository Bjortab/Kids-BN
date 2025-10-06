import { getUser } from "./_auth";

export async function onRequest(context){
  const { env } = context;
  const headers = {
    "Access-Control-Allow-Origin": env.KIDSBN_ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json"
  };
  if (context.request.method === "OPTIONS") return new Response(null, { status: 204, headers });

  const user = await getUser(context);
  if(!user) return new Response(JSON.stringify({ error: "UNAUTH" }), { status: 401, headers });

  const entKV = env.kidsbn_entitlements;
  const usageKV = env.kidsbn_usage;

  const entRaw = await entKV.get(`ent:${user.id}`, "json");
  const ent = entRaw || { plan: "free", tokens_left: 0, monthly_quota: 8, renews_at: null, status: "active" };

  const ym = new Date().toISOString().slice(0,7);
  const used = Number(await usageKV.get(`m:${user.id}:${ym}`)) || 0;

  const payload = {
    plan: ent.plan,
    status: ent.status || "active",
    tokens_left: ent.tokens_left || 0,
    monthly_quota: ent.monthly_quota || (ent.plan==="plus" ? 100 : ent.plan==="mini" ? 30 : 8),
    used_this_month: used
  };
  return new Response(JSON.stringify(payload), { status: 200, headers });
}
