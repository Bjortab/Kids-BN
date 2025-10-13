// functions/api/tts.js
export async function onRequestPost(context) {
  try {
    const { text } = await context.request.json();

    if (!text) {
      return new Response(JSON.stringify({ error: 'Ingen text skickades till TTS.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // === Testljud (1 sek tyst wav, fungerar i Cloudflare) ===
    const silentWavBase64 = "UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
    const binary = Uint8Array.from(atob(silentWavBase64), c => c.charCodeAt(0));

    return new Response(binary, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Access-Control-Allow-Origin": "*"
      }
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || 'Fel i TTS' }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// ✅ Lägg även till detta så att OPTIONS-förfrågningar godkänns
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
