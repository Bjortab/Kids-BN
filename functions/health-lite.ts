// /functions/health-lite.ts
export async function onRequest({ env }: { env: any }) {
  const checks: string[] = [];

  // D1
  try {
    const row = await env.BN_DB.prepare("SELECT 1 as ok").first<{ ok: number }>();
    checks.push((row?.ok === 1) ? "✅ D1 OK" : "❌ D1 FAIL");
  } catch {
    checks.push("❌ D1 FAIL");
  }

  // R2 audio
  try {
    const r = await env["bn-audio"].list({ limit: 1 });
    checks.push(Array.isArray(r.objects) ? "✅ R2 Audio OK" : "❌ R2 Audio FAIL");
  } catch {
    checks.push("❌ R2 Audio FAIL");
  }

  // R2 images
  try {
    const r = await env["bn-images"].list({ limit: 1 });
    checks.push(Array.isArray(r.objects) ? "✅ R2 Images OK" : "❌ R2 Images FAIL");
  } catch {
    checks.push("❌ R2 Images FAIL");
  }

  const body = checks.join("\n") + "\n";
  const allOk = checks.every(line => line.includes("✅"));

  return new Response(body, {
    status: allOk ? 200 : 500,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
  });
}
