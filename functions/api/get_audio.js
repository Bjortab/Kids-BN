// functions/api/get_audio.js
// BN-KIDS TTS via Google Cloud Text-to-Speech
// Anropas från app_playTTS.js med POST /api/get_audio
// Body: { text: string, voice?: string }

export async function onRequestOptions({ env }) {
  const origin =
    env.KIDSBM_ALLOWED_ORIGIN ||
    env.KIDSBM_ALLOWED_ORIGIN_DEV ||
    env.KIDSBM_ALLOWED_ORIGIN_LOCAL ||
    env.KIDSBM_ALLOWED_ORIGIN_PREVIEW ||
    env.KIDSBM_ALLOWED_ORIGIN_PROD ||
    env.KIDSBM_ALLOWED_ORIGIN_KIDS ||
    env.KIDSBM_ALLOWED_ORIGIN_BN ||
    env.KIDSBM_ALLOWED_ORIGIN_KIDSBM ||
    "*";

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

export async function onRequestPost({ request, env }) {
  const origin =
    env.KIDSBM_ALLOWED_ORIGIN ||
    env.KIDSBM_ALLOWED_ORIGIN_DEV ||
    env.KIDSBM_ALLOWED_ORIGIN_LOCAL ||
    env.KIDSBM_ALLOWED_ORIGIN_PREVIEW ||
    env.KIDSBM_ALLOWED_ORIGIN_PROD ||
    env.KIDSBM_ALLOWED_ORIGIN_KIDS ||
    env.KIDSBM_ALLOWED_ORIGIN_BN ||
    env.KIDSBM_ALLOWED_ORIGIN_KIDSBM ||
    "*";

  try {
    const body = await request.json().catch(() => ({}));
    const text = (body.text || body.story || "").trim();
    const voiceId = (body.voice || "").trim();

    if (!text) {
      return json(
        { ok: false, error: "Ingen text att läsa upp." },
        400,
        origin
      );
    }

    const apiKey = env.KIDSBM_GOOGLE_TTS_API_KEY;
    if (!apiKey) {
      return json(
        { ok: false, error: "KIDSBM_GOOGLE_TTS_API_KEY saknas i env." },
        500,
        origin
      );
    }

    // Standardröst – kan justeras senare
    const voice = voiceId || "sv-SE-Wavenet-C";

    const payload = {
      input: { text },
      voice: {
        languageCode: "sv-SE",
        name: voice
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: 1.0
      }
    };

    const ttsRes = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(
        apiKey
      )}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    if (!ttsRes.ok) {
      const errText = await ttsRes.text().catch(() => "");
      return json(
        {
          ok: false,
          error: "Google TTS-fel",
          details: errText.slice(0, 400)
        },
        502,
        origin
      );
    }

    const data = await ttsRes.json();
    const audioBase64 = data.audioContent;

    if (!audioBase64) {
      return json(
        { ok: false, error: "Tomt ljud från Google TTS." },
        502,
        origin
      );
    }

    // Dekoda base64 → binär MP3
    const binary = Uint8Array.from(
      atob(audioBase64),
      (c) => c.charCodeAt(0)
    );

    return new Response(binary, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Access-Control-Allow-Origin": origin
      }
    });
  } catch (e) {
    return json(
      { ok: false, error: "Serverfel i get_audio", details: String(e).slice(0, 400) },
      500,
      origin
    );
  }
}

function json(obj, status = 200, origin = "*") {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      "Access-Control-Allow-Origin": origin
    }
  });
}
