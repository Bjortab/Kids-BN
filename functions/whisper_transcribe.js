// functions/api/whisper_transcribe.js
// Tar emot FormData med `audio` (webm/mp3/m4a/ogg/wav), returnerar { ok, text }

const CORS = (env) => ({
  "Access-Control-Allow-Origin": env?.BN_ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
});

export async function onRequestOptions({ env }) {
  return new Response(null, { status: 204, headers: CORS(env) });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "OPENAI_API_KEY saknas" }), {
        status: 500, headers: { "Content-Type": "application/json", ...CORS(env) }
      });
    }

    const form = await request.formData();
    const file = form.get("audio");
    if (!file) {
      return new Response(JSON.stringify({ ok: false, error: "Ingen ljudfil (audio) bifogad" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS(env) }
      });
    }

    const whisperForm = new FormData();
    whisperForm.append("file", file, "recording.webm");
    whisperForm.append("model", env.WHISPER_MODEL || "whisper-1");
    whisperForm.append("language", "sv");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
      body: whisperForm
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ ok: false, error: `Whisper ${res.status}: ${err}` }), {
        status: 500, headers: { "Content-Type": "application/json", ...CORS(env) }
      });
    }

    const data = await res.json();
    return new Response(JSON.stringify({ ok: true, text: data.text || "" }), {
      headers: { "Content-Type": "application/json", ...CORS(env) }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS(env) }
    });
  }
}

export async function onRequest() {
  return new Response("Method Not Allowed", { status: 405 });
}
