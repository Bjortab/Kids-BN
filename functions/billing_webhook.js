// functions/billing_webhook.js
// Exempel-webhook för Stripe (POST → /billing_webhook)
export async function onRequestPost({ request }) {
  // Verifiera Stripe-signatur om du använder den:
  // const sig = request.headers.get('Stripe-Signature');
  // ...
  return new Response("ok", { status: 200 });
}

export async function onRequest() {
  return new Response("Method Not Allowed", { status: 405 });
}
