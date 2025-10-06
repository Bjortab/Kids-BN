import { getUser } from "./_auth";

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

  const user = await getUser(context);
  if(!user) return new Response(JSON.stringify({ error: "UNAUTH" }), { status: 401, headers });

  const body = await request.json().catch(()=> ({}));
  const product = body.product;

  const PRICE_TOKENS20 = env.STRIPE_PRICE_TOKENS20; // ex: price_123
  const PRICE_SUB_PLUS  = env.STRIPE_PRICE_SUB_PLUS; // ex: price_abc (recurring)
  const priceId = product === "tokens20" ? PRICE_TOKENS20 : PRICE_SUB_PLUS;
  if(!priceId) return new Response(JSON.stringify({ error: "MISSING_PRICE" }), { status: 400, headers });

  const origin = new URL(request.url).origin;
  const successUrl = `${origin}?purchase=success`;
  const cancelUrl  = `${origin}?purchase=cancel`;

  const params = new URLSearchParams();
  params.append("mode", product === "tokens20" ? "payment" : "subscription");
  params.append("success_url", successUrl);
  params.append("cancel_url", cancelUrl);
  params.append("client_reference_id", user.id);
  params.append("customer_email", user.email);
  params.append("line_items[0][price]", priceId);
  params.append("line_items[0][quantity]", "1");
  params.append("metadata[user_id]", user.id);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });
  if(!res.ok){ const text=await res.text(); return new Response(JSON.stringify({ error:"CHECKOUT_FAIL", detail:text }), { status:500, headers }); }
  const data = await res.json();
  return new Response(JSON.stringify({ url: data.url }), { status: 200, headers });
}
