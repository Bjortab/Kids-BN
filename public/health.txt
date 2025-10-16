// /functions/health.ts
// Enkel systemkontroll för BN-projektet (Kids-BN / Core-BN etc.)

export async function onRequest({ env }: { env: any }) {
  try {
    // Testa D1-databasen
    let d1Ok = false;
    try {
      const stmt = env.BN_DB.prepare("SELECT 1 as ok");
      const row = await stmt.first<{ ok: number }>();
      d1Ok = row?.ok === 1;
    } catch {
      d1Ok = false;
    }

    // Testa R2-ljudbucket
    let r2AudioOk = false;
    try {
      const audioList = await env["bn-audio"].list({ limit: 1 });
      r2AudioOk = Array.isArray(audioList.objects);
    } catch {
      r2AudioOk = false;
    }

    // Testa R2-bildbucket
    let r2ImagesOk = false;
    try {
      const imageList = await env["bn-images"].list({ limit: 1 });
      r2ImagesOk = Array.isArray(imageList.objects);
    } catch {
      r2ImagesOk = false;
    }

    // Svar i JSON-format
    const result = {
      status: "ok",
      checks: {
        d1_database: d1Ok ? "ok" : "fail",
        r2_audio: r2AudioOk ? "ok" : "fail",
        r2_images: r2ImagesOk ? "ok" : "fail",
      },
      timestamp: new Date().toISOString(),
    };

    const allOk = d1Ok && r2AudioOk && r2ImagesOk;

    return new Response(JSON.stringify(result, null, 2), {
      status: allOk ? 200 : 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify(
        { status: "error", message: err?.message ?? String(err) },
        null,
        2
      ),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}
