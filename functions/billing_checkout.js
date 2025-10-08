export async function onRequestPost({ request, env }) {
  const sig = request.headers.get("stripe-signature");
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response("Missing STRIPE_WEBHOOK_SECRET", { status:500 });

  const payload = await request.text();
  const valid = await verifyStripeSignature(payload, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return new Response("Invalid signature", { status:400 });

  const event = JSON.parse(payload);
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        // TODO: Mappa s.customer_email/s.customer till din användare (Supabase)
        // Demo: markera i KV 24h
        await env.kidsbn_entitlements?.put(`last_checkout:${s.customer_email || s.customer}`, JSON.stringify({ when: Date.now() }), { expirationTtl: 86400 });
        break;
      }
      case "invoice.paid": {
        const inv = event.data.object;
        await env.kidsbn_entitlements?.put(`invoice:${inv.customer}`, JSON.stringify({ paid:true, at: Date.now() }), { expirationTtl: 86400 });
        break;
      }
      default: break;
    }
    return new Response("ok");
  } catch (e) {
    return new Response("hook error: " + (e?.message || e), { status:500 });
  }
}

async function verifyStripeSignature(payload, signature, secret) {
  if (!signature) return false;
  const parts = Object.fromEntries(signature.split(",").map(kv => kv.split("=",2)));
  if (!parts.t || !parts.v1) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const signedPayload = `${parts.t}.${payload}`;
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const expected = [...new Uint8Array(sigBuf)].map(b=>b.toString(16).padStart(2,"0")).join("");
  return timingSafeEqual(expected, parts.v1);
}
function timingSafeEqual(a,b){ if(!a||!b||a.length!==b.length) return false; let r=0; for(let i=0;i<a.length;i++) r|=a.charCodeAt(i)^b.charCodeAt(i); return r===0; }
