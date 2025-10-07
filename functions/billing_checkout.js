// POST /billing_checkout  { mode: "sub"|"one", email?: string }
export async function onRequestPost({ request, env }) {
  const allow = env.KIDSBN_ALLOWED_ORIGIN || "*";
  try {
    const { mode, email } = await request.json();
    if (!env.STRIPE_SECRET_KEY) {
      return new Response(JSON.stringify({ error: "Stripe not configured" }), { status: 500, headers: cors(allow) });
    }
    const price =
      mode === "sub" ? env.STRIPE_PRICE_SUB_PLUS :
      mode === "one" ? env.STRIPE_PRICE_TOKENS20 : null;
    if (!price) {
      return new Response(JSON.stringify({ error: "Invalid mode" }), { status: 400, headers: cors(allow) });
    }

    const success = env.CHECKOUT_SUCCESS_URL || (new URL(request.url)).origin + "/?paid=1";
    const cancel  = env.CHECKOUT_CANCEL_URL  || (new URL(request.url)).origin + "/?canceled=1";

    // Create Checkout session
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        mode: mode === "sub" ? "subscription" : "payment",
        "line_items[0][price]": price,
        "line_items[0][quantity]": "1",
        success_url: success,
        cancel_url: cancel,
        ...(email ? { customer_email: email } : {}),
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: "Stripe error", details: data }), { status: 502, headers: cors(allow) });
    }
    return new Response(JSON.stringify({ url: data.url }), { status: 200, headers: cors(allow) });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || "Server error" }), { status: 500, headers: cors(allow) });
  }
}

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
