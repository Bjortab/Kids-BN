// functions/api/whisper_transcribe.js

const cors = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
});

// CORS preflight
export async function onRequestOptions({ env }) {
  return new Response(null, { status: 204, headers: cors(env?.BN_ALLOWED_ORIGIN) });
}

export async function onRequestPost({ request, env }) {
  const headers = { ...cors(env?.BN_ALLOWED_ORIGIN), "Content-Type": "application/json" };
  try {
    const apiKey = env?.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY saknas" }), { status: 500, headers });
    }

    // 1) Läs inkommande som antingen raw webm eller multipart
    let fileBlob;
    const contentType = request.headers.get("content-type") || "";
    if (contentType.startsWith("audio/")) {
      const ab = await request.arrayBuffer();
      fileBlob = new Blob([ab], { type: contentType });
    } else if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string") {
        return new Response(JSON.stringify({ error: "Ingen fil i form-data" }), { status: 400, headers });
      }
      fileBlob = file; // File/Blob
    } else {
      return new Response(JSON.stringify({ error: "Fel content-type. Skicka audio/webm eller multipart/form-data." }), { status: 415, headers });
    }

    // 2) Bygg upstream multipart för OpenAI Transcriptions
    const upstreamForm = new FormData();
    upstreamForm.append("model", "whisper-1");
    // OpenAI kräver ett fältnamn "file"
    upstreamForm.append("file", fileBlob, "speech.webm");
    // valfritt språk-hint
    upstreamForm.append("language", "sv");

    const upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}` },
      body: upstreamForm
    });

    if (!upstream.ok) {
      const t = await upstream.text().catch(()=> "");
      return new Response(JSON.stringify({ error: `OpenAI Whisper fel: ${upstream.status} ${t}` }), { status: 502, headers });
    }

    const data = await upstream.json();
    // OpenAI svarar t.ex. { text: "..." }
    const text = (data?.text || "").trim();
    return new Response(JSON.stringify({ text }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500, headers });
  }
}
