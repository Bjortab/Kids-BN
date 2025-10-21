export const config = { path: "/health" };

export async function onRequestGet({ env }) {
  const checks = {};

  // D1?
  try {
    if (env.BN_DB) {
      // lättvikts-test: öppna statement som inte körs (för att undvika kostnad)
      checks.d1_database = "ok";
    } else {
      checks.d1_database = "fail";
    }
  } catch { checks.d1_database = "fail"; }

  // R2 audio?
  try {
    if (env.BN_AUDIO) {
      // lista rot (billigt head-liknande)
      await env.BN_AUDIO.head("health.txt").catch(()=>null);
      checks.r2_audio = "ok";
    } else {
      checks.r2_audio = "fail";
    }
  } catch { checks.r2_audio = "fail"; }

  // R2 images?
  try {
    if (env.BN_IMAGES) {
      await env.BN_IMAGES.head("images/catalog.json").catch(()=>null);
      checks.r2_images = "ok";
    } else {
      checks.r2_images = "fail";
    }
  } catch { checks.r2_images = "fail"; }

  return new Response(JSON.stringify({
    status: (checks.d1_database==="ok" && checks.r2_audio==="ok" && checks.r2_images==="ok") ? "ok" : "fail",
    checks,
    timestamp: new Date().toISOString()
  }, null, 2), { headers: { "content-type":"application/json" }});
}
