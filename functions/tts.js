// functions/tts.js
// POST /tts  -> body: { text, voiceId?, speed? }
// - Tvingar ElevenLabs "eleven_multilingual_v2"
// - SSML lang="sv-SE" om LANG_DEFAULT=sv
// - Cacha HELA sagans mp3 i R2 (BN_AUDIOS)
// - Sätter x-tts-cache: hit|miss och x-tts-total/hits (enkel signal)

export const onRequestPost = async ({ request, env }) => {
  try {
    const { ELEVEN_API_KEY, ELEVEN_VOICE_ID, LANG_DEFAULT } = env;
    if (!ELEVEN_API_KEY) return j({ ok:false, error:"Saknar ELEVEN_API_KEY" }, 500);
    const body = await request.json().catch(()=> ({}));
    let { text = "", voiceId = "", speed } = body || {};
    voiceId = (voiceId || ELEVEN_VOICE_ID || "").trim();

    // Minimalt skydd
    text = (text || "").toString().trim();
    if (!text) return j({ ok:false, error:"Tom text" }, 400);
    if (!voiceId) return j({ ok:false, error:"Saknar voiceId" }, 400);

    // 1) Normalisera text (ta bort [BYT SIDA] osv som kan störa språkdetektion)
    const cleaned = normalizeText(text);

    // 2) SSML med språk-hint (sv default)
    const lang = (LANG_DEFAULT || "sv").toLowerCase().startsWith("sv") ? "sv-SE" : "en-US";
    const ssml = `<speak><lang xml:lang="${lang}">${escapeXml(cleaned)}</lang></speak>`;

    // 3) Cache-nyckel (hela sagan)
    const cacheKey = await sha1(`${voiceId}|eleven_multilingual_v2|${lang}|${cleaned}`);
    const keyPath  = `stories/${cacheKey}.mp3`;

    // 3a) R2: finns redan?
    let cacheHit = false;
    let mp3Obj = await env.BN_AUDIOS.get(keyPath);
    if (mp3Obj) {
      cacheHit = true;
      const arr = await mp3Obj.arrayBuffer();
      return new Response(arr, {
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

    // 4) ElevenLabs-anrop
    const reqPayload = {
      model_id: "eleven_multilingual_v2",
      // text eller SSML: använd "use_ssml": true enligt nya API, men bakåtkomp:
      // Om ditt konto behöver fältet:
      // "use_ssml": true,
      text: ssml,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.6,
        style: 0.2,
        use_speaker_boost: true
      },
      // output-format
      output_format: "mp3_44100_128"
    };

    // Notera: vissa konton har "voice_speed" (0.5–2.0). Använd om tillgängligt:
    if (typeof speed === "number" && speed > 0 && speed !== 1) {
      reqPayload.voice_speed = Math.max(0.5, Math.min(2.0, speed));
    }

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVEN_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(reqPayload)
    });

    if (!r.ok) {
      const errTxt = await r.text().catch(()=> "");
      // Om fel → skicka tydligt svar så vi ser i Network
      return j({ ok:false, error:`ElevenLabs ${r.status}: ${errTxt}` }, 502);
    }

    const mp3 = await r.arrayBuffer();

    // 5) Spara i R2
    await env.BN_AUDIOS.put(keyPath, mp3, {
      httpMetadata: { contentType: "audio/mpeg", cacheControl: "public, max-age=31536000, immutable" }
    });

    return new Response(mp3, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
        "x-tts-cache": cacheHit ? "hit" : "miss",
        "x-tts-total": "1",
        "x-tts-hits": cacheHit ? "1" : "0"
      }
    });
  } catch (e) {
    return j({ ok:false, error: String(e?.message || e) }, 500);
  }
};

// ---------------- helpers ----------------

const j = (obj, status=200, headers={}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type":"application/json; charset=utf-8", ...headers }
  });

function normalizeText(t) {
  // Ta bort stage directions / BYT SIDA-markörer etc som kan störa
  return t
    .replace(/\[BYT SIDA\]/gi, "")
    .replace(/^\s*Kapitel\s+\d+:\s*/gmi, "") // TTS behöver inte rubriker varje gång
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeXml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sha1(s) {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-1", enc);
  const bytes = Array.from(new Uint8Array(buf));
  return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
}
