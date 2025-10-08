export async function onRequestGet(context) {
  const env = context.env || {};
  const keys = [
    "OPENAI_API_KEY",
    "ELEVENLABS_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE",
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "MERCH_API_KEY",
    "BN_ALLOWED_ORIGIN",
    "BN_ENV",
  ];

  const results = {};

  for (const key of keys) {
    if (env[key]) {
      results[key] = "✅ Loaded";
    } else {
      results[key] = "❌ Missing";
    }
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
