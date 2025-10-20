// functions/tts.js
// POST /tts  body: { text, voiceId? }
// - Tvingar svenska via SSML sv-SE
// - ElevenLabs "eleven_multilingual_v2"
// - Cacha HELA sagans mp3 i R2 (BN_AUDIOS)
// - Return headers: x-tts-cache (hit/miss), x-tts-total/hits

export const onRequestPost = async ({ request, env }) => {
  try {
    const { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, LANG_DEFAULT } = env;
    if (!ELEVENLABS_API_KEY) return j({ ok:false, error:"Saknar ELEVENLABS_API_KEY" }, 500);

    const body = await request.json().catch(()=> ({}));
    let { text = "", voiceId = "" } = body || {};
    text = (text||"").toString().trim();
    if (!text) return j({ ok:false, error:"Tom text" }, 400);

    const voice = (voiceId || ELEVENLABS_VOICE_ID || "").trim();
    if (!voice) return j({ ok:false, error:"Saknar ELEVENLABS_VOICE_ID" }, 500);

    const lang = (LANG_DEFAULT||"sv").toLowerCase().startsWith("sv") ? "sv-SE" : "en-US";
    const cleaned = sanitizeText(text);
    const ssml = `<speak><lang xml:lang="${lang}">${escapeXml(cleaned)}</lang></speak>`;

    // Cache-nyckel (hela sagan)
    const key = await sha1(`${voice}|eleven_multilingual_v2|${lang}|${cleaned}`);
    const r2Key = `stories/${key}.mp3`;

    // R2 hit?
    let hit = false;
    const existing = await env.BN_AUDIOS.get(r2Key);
    if (existing) {
      hit = true;
      const buf = await existing.arrayBuffer();
      return new Response(buf, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "public, max-age=31536000, immutable",
          "x-tts-cache": "hit",
          "x-tts-total": "1",
          "x-tts-hits": "1"
        }
      });
    }

    // ElevenLabs
    const elRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model_id: "eleven_multilingual_v2",
        text: ssml,
        output_format: "mp3_44100_128",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.6,
          style: 0.2,
          use_speaker_boost: true
        }
      })
    });

    if (!elRes.ok) {
      const t = await elRes.text().catch(()=> "");
      return j({ ok:false, error:`ElevenLabs ${elRes.status}: ${t}` }, 502);
    }

    const mp3 = await elRes.arrayBuffer();
    await env.BN_AUDIOS.put(r2Key, mp3, {
      httpMetadata: { contentType: "audio/mpeg", cacheControl: "public, max-age=31536000, immutable" }
    });

    return new Response(mp3, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
        "x-tts-cache": hit ? "hit" : "miss",
        "x-tts-total": "1",
        "x-tts-hits": hit ? "1" : "0"
      }
    });
  } catch (e) {
    return j({ ok:false, error: String(e?.message || e) }, 500);
  }
};

function j(obj, status=200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type":"application/json; charset=utf-8" }
  });
}
function sanitizeText(raw) {
  return String(raw||"")
    .replace(/\[BYT SIDA\]/gi, "")
    .replace(/^#+\s*/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function escapeXml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
async function sha1(s) {
  const u8 = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-1", u8);
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
