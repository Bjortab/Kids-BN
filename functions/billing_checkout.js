export async function onRequestPost({ request, env }) {
  const allow = env.BN_ALLOWED_ORIGIN || "*";
  try {
    const { mode, email } = await request.json();
    if (!env.STRIPE_SECRET_KEY) return json({ error:"Stripe not configured" }, 500, allow);

    const price =
      mode === "sub" ? env.STRIPE_PRICE_SUB_PLUS :
      mode === "one" ? env.STRIPE_PRICE_TOKENS20 : null;
    if (!price) return json({ error:"Invalid mode" }, 400, allow);

    const base = new URL(request.url).origin;
    const success = env.CHECKOUT_SUCCESS_URL || `${base}/?paid=1`;
    const cancel  = env.CHECKOUT_CANCEL_URL  || `${base}/?canceled=1`;

    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method:"POST",
      headers:{ Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type":"application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        mode: mode === "sub" ? "subscription" : "payment",
        "line_items[0][price]": price,
        "line_items[0][quantity]": "1",
        success_url: success,
        cancel_url: cancel,
        ...(email ? { customer_email: email } : {})
      })
    });
    const data = await r.json();
    if (!r.ok) return json({ error:"Stripe error", details:data }, 502, allow);
    return json({ url: data.url }, 200, allow);
  } catch (e) { return json({ error:e?.message || "Server error" }, 500, allow); }
}

function cors(origin){
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
function json(obj, status, origin){ return new Response(JSON.stringify(obj), { status, headers: { "Content-Type":"application/json", ...cors(origin) } }); }
export async function onRequestOptions({ env }) { return new Response(null, { status:204, headers: cors(env.BN_ALLOWED_ORIGIN || "*") }); }
