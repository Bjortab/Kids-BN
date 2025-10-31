// Lägg detta högst upp i functions/tts_vertex.js
export async function onRequestOptions({ env }) {
  const origin = env.KIDSBN_ALLOWED_ORIGIN || '*';
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}
import { GoogleAuth } from "google-auth-library";

// Hämta nyckel från Cloudflare Secret (du har lagt in den som GOOGLE_TTS_KEY)
const googleKey = JSON.parse(process.env.GOOGLE_TTS_KEY || "{}");

// Initiera autentisering
const auth = new GoogleAuth({
  credentials: googleKey,
  scopes: ["https://www.googleapis.com/auth/cloud-platform"]
});

const GOOGLE_TTS_ENDPOINT =
  "https://texttospeech.googleapis.com/v1/text:synthesize";

/**
 * Genererar TTS med Google Cloud (Chirp 3 HD / WaveNet / Neural2)
 * @param {Object} params - inställningar
 * @param {string} params.text - Texten som ska läsas upp
 * @param {string} [params.voice="sv-SE-Standard-A"] - Rösten
 * @param {string} [params.model="chirp"] - Typ av modell (chirp / wavenet / neural2)
 * @param {string} [params.lang="sv-SE"] - Språk
 * @param {string} [params.format="MP3"] - Utdataformat
 * @returns {Promise<Blob>} - MP3-ljudfil som Blob
 */
export async function synthesizeTTS({
  text,
  voice = "sv-SE-Standard-A",
  model = "chirp",
  lang = "sv-SE",
  format = "MP3"
}) {
  if (!text || text.trim().length === 0) {
    throw new Error("Ingen text angiven för TTS.");
  }

  const client = await auth.getClient();
  const token = await client.getAccessToken();

  const body = {
    input: { text },
    voice: {
      languageCode: lang,
      name:
        model === "chirp"
          ? "sv-SE-Chirp-3-HD"
          : model === "wavenet"
          ? "sv-SE-Wavenet-A"
          : "sv-SE-Neural2-A"
    },
    audioConfig: { audioEncoding: format }
  };

  const res = await fetch(GOOGLE_TTS_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`TTS-fel: ${res.status} – ${errText}`);
  }

  const data = await res.json();
  const audioBuffer = Buffer.from(data.audioContent, "base64");
  return audioBuffer;
}

/**
 * Cloudflare Worker-kompatibel hantering (om du kör via API-route)
 */
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/tts_vertex") {
        const { text, voice, model, lang } = await request.json();
        const audioBuffer = await synthesizeTTS({ text, voice, model, lang });

        return new Response(audioBuffer, {
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "public, max-age=31536000"
          }
        });
      }
      return new Response("Not Found", { status: 404 });
    } catch (err) {
      return new Response(`TTS error: ${err.message}`, { status: 500 });
    }
  }
};
