// functions/api/whisper_transcribe.js
// POST /api/whisper_transcribe   (body: audio/webm)
// Returnerar: { ok:true, text:"..." }
// OPTIONS hanteras för att undvika 405 preflight

const ORIGIN = "*"; // sätt din domän i prod

export const onRequestOptions = async () =>
  new Response(null, { status: 204, headers: cors() });

export const onRequestGet = async () =>
  new Response(JSON.stringify({ ok:false, error:"Use POST" }), {
    status: 405,
    headers: { "Content-Type":"application/json", ...cors() }
  });

export const onRequestPost = async ({ request, env }) => {
  try {
    const apiKey = env.OPENAI_API_KEY;
    const model  = env.WHISPER_MODEL || "whisper-1";
    if (!apiKey) return json({ ok:false, error:"Saknar OPENAI_API_KEY" }, 500);

    const ct = request.headers.get("Content-Type") || "";
    if (!ct.includes("audio/")) return json({ ok:false, error:"Förväntade audio/*" }, 400);

    const buf = await request.arrayBuffer();
    const blob = new Blob([buf], { type: ct });

    const fd = new FormData();
    fd.append("file", blob, "speech.webm");
    fd.append("model", model);
    fd.append("language", "sv");

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd
    });

    if (!r.ok) {
      const t = await r.text().catch(()=> "");
      return json({ ok:false, error:`Whisper ${r.status}: ${t}` }, 502);
    }
    const data = await r.json();
    return json({ ok:true, text: (data.text||"").trim() }, 200);
  } catch (e) {
    return json({ ok:false, error: String(e?.message || e) }, 500);
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };
}
function json(obj, status=200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type":"application/json; charset=utf-8", ...cors() }
  });
}
