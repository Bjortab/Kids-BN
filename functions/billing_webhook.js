// POST /billing_webhook  (Stripe calls this)
export async function onRequestPost({ request, env }) {
  const sig = request.headers.get("stripe-signature");
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response("Missing STRIPE_WEBHOOK_SECRET", { status: 500 });
  }
  // Verify signature (manual endpoint-secure check)
  const payload = await request.text();
  const valid = await verifyStripeSignature(payload, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return new Response("Invalid signature", { status: 400 });

  const event = JSON.parse(payload);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        // You can read mode: subscription or payment
        const s = event.data.object;
        // TODO: map s.customer_email / s.customer to your user (via Supabase)
        // Example: mark latest purchase in KV (simple)
        await env.kidsbn_entitlements.put(`last_checkout:${s.customer_email || s.customer}`, JSON.stringify(s), { expirationTtl: 60*60*24 });
        break;
      }
      case "invoice.paid": {
        const inv = event.data.object;
        // TODO: set user plan=plus, or top-up tokens, using Supabase SERVICE_ROLE
        // Minimal no-op for now:
        await env.kidsbn_entitlements.put(`invoice:${inv.customer}`, JSON.stringify({ paid: true, at: Date.now() }), { expirationTtl: 60*60*24 });
        break;
      }
      default:
        // ignore
        break;
    }
    return new Response("ok");
  } catch (err) {
    return new Response("hook error: " + (err?.message || err), { status: 500 });
  }
}

// Lightweight signature verification using Stripe's v1 scheme (HMAC SHA256)
async function verifyStripeSignature(payload, signature, secret) {
  if (!signature) return false;
  // signature like: t=...,v1=...,v0=...
  const parts = Object.fromEntries(signature.split(",").map(kv => kv.split("=",2)));
  if (!parts.t || !parts.v1) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signedPayload = `${parts.t}.${payload}`;
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const expected = [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2,"0")).join("");
  return timingSafeEqual(expected, parts.v1);
}

function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
