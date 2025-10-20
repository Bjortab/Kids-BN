// functions/api/whisper_transcribe.js
// Tar emot RAW audio/webm (ingen multipart på klienten), skickar vidare till OpenAI Whisper.
// Returnerar JSON: { ok:true, text:"..." } eller fel.

const DEFAULT_MODEL = "whisper-1"; // eller "gpt-4o-transcribe" om du använder den

function allowOrigin(origin) {
  try {
    const u = new URL(origin || "");
    return u.hostname === "localhost" || u.host.endsWith(".pages.dev");
  } catch { return false; }
}
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": allowOrigin(origin) ? origin : "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json; charset=utf-8",
  };
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export async function onRequestPost({ request, env }) {
  const headers = corsHeaders(request.headers.get("origin"));
  try {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ ok:false, error:"OPENAI_API_KEY saknas" }), { status: 500, headers });
    }

    // Din front-end skickar rå webm
    const ctype = (request.headers.get("content-type") || "").toLowerCase();
    if (!ctype.includes("audio/")) {
      return new Response(JSON.stringify({ ok:false, error:"Förväntade audio/* i Content-Type" }), { status: 400, headers });
    }

    // Läs rå kropp som blob
    const audioBlob = await request.blob();
    if (!audioBlob || !audioBlob.size) {
      return new Response(JSON.stringify({ ok:false, error:"Tom ljudkropp" }), { status: 400, headers });
    }

    // Bygg multipart till OpenAI
    const form = new FormData();
    // filnamn: viktigt för OpenAI
    form.append("file", audioBlob, "speech.webm");
    form.append("model", env.WHISPER_MODEL || DEFAULT_MODEL);
    // valfritt språk
    form.append("language", "sv");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const txt = await res.text().catch(()=> "");
      return new Response(JSON.stringify({ ok:false, error:`OpenAI ${res.status}`, detail: txt }), { status: 502, headers });
    }

    const data = await res.json();
    const text = (data.text || "").trim();
    return new Response(JSON.stringify({ ok:true, text }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ ok:false, error: String(err?.message || err) }), { status: 500, headers });
  }
}
