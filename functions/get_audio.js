// functions/get_audio.js
// BN-Kids — Google TTS via Cloudflare Worker
// GC v1.0

export async function onRequestPost({ request, env }) {
  try {
    const { text, voice } = await request.json().catch(() => ({}));

    if (!text || text.trim().length === 0) {
      return json({ ok: false, error: "Ingen text angiven." }, 400);
    }

    if (!env.GOOGLE_TTS_API_KEY) {
      return json({ ok: false, error: "GOOGLE_TTS_API_KEY saknas." }, 500);
    }

    if (!env.GOOGLE_PROJECT_ID) {
      return json({ ok: false, error: "GOOGLE_PROJECT_ID saknas." }, 500);
    }

    // Standardröst — du kan ändra senare
    const selectedVoice = voice || "sv-SE-Neural2-A";

    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${env.GOOGLE_TTS_API_KEY}`;

    const payload = {
      input: { text },
      voice: {
        languageCode: "sv-SE",
        name: selectedVoice
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: 1.0,
        pitch: 0.0
      }
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.text();
      return json(
        { ok: false, error: "Google TTS-fel", details: err.slice(0, 300) },
        502
      );
    }

    const data = await res.json();

    if (!data.audioContent) {
      return json({ ok: false, error: "Tomt ljud från Google." }, 500);
    }

    // Base64 → binär mp3
    const audioArray = Uint8Array.from(atob(data.audioContent), c =>
      c.charCodeAt(0)
    );

    return new Response(audioArray, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (err) {
    return json(
      { ok: false, error: "Serverfel", details: String(err).slice(0, 200) },
      500
    );
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
