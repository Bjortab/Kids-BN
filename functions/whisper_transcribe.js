// /api/whisper_transcribe  —  POST form-data med 'audio' (Blob)
// Returnerar { ok:true, text } eller tydligt fel.

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost({ request, env }) {
  try {
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return Response.json(
        { ok: false, error: "Content-Type måste vara multipart/form-data", status: 400 },
        { status: 400, headers: corsHeaders() }
      );
    }

    if (!env.OPENAI_API_KEY) {
      return Response.json(
        { ok: false, error: "OPENAI_API_KEY saknas i miljön", status: 501 },
        { status: 501, headers: corsHeaders() }
      );
    }

    // Här kan du skicka blobben till OpenAI Whisper/”gpt-4o-mini-transcribe”.
    // För test återger vi bara ett demo-svar så att 405 försvinner.
    return Response.json(
      { ok: true, text: "Demo-transkribering (konfiguration ej klar)." },
      { headers: corsHeaders() }
    );
  } catch (err) {
    return Response.json(
      { ok: false, error: `Serverfel: ${err.message}`, status: 500 },
      { status: 500, headers: corsHeaders() }
    );
  }
}
