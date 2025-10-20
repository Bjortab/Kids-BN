// functions/tts.js
/**
 * Text → Speech med ElevenLabs + enkel R2-cache.
 * - Respekterar env.ELEVENLABS_VOICE_ID som standardröst
 * - Tillåter override via body.voiceId
 * - Cache-nyckel: sha1(text|voiceId|model|format)
 * - Returnerar MP3
 *
 * Kräver:
 *   - env.ELEVENLABS_API_KEY (Secret)
 *   - (valfritt) env.ELEVENLABS_VOICE_ID (Secret/Var)
 *   - R2 binding: env.BN_AUDIO -> R2-bucket (t.ex. bn-audio)
 */

export const onRequestPost = async ({ request, env }) => {
  let hits = 0;
  let total = 0;

  try {
    // ---- Läs in body ----
    const body = await request.json().catch(() => ({}));
    const textRaw = (body?.text ?? "").toString();
    const voiceOverride = (body?.voiceId ?? "").toString().trim();

    // ---- Standardröstlogik (ingen ny secret behövs) ----
    // Prioritet: body.voiceId > env.ELEVENLABS_VOICE_ID > fallback
    const defaultVoice = (env.ELEVENLABS_VOICE_ID ?? "").toString().trim();
    const voiceId = (voiceOverride || defaultVoice || "21m00Tcm4TlvDq8ikWAM").trim();
    // (fallback = Ella, byt gärna till din favorit om du vill)

    if (!env.ELEVENLABS_API_KEY) {
      return jsonErr(500, "ELEVENLABS_API_KEY saknas (Secret).");
    }
    if (!env.BN_AUDIO) {
      return jsonErr(500, "R2-binding BN_AUDIO saknas.");
    }
    if (!textRaw) {
      return jsonErr(400, "Ingen text att läsa upp.");
    }
    // Rensa bort potentiell kontrolltext i 1–2-års-stil (t.ex. [BYT SIDA])
    const text = textRaw.replace(/\[BYT SIDA\]/g, " ").replace(/\s{2,}/g, " ").trim();

    // En mycket enkel check så man inte råkar skicka in "SÄTT_DIN_RÖST_ID_HÄR"
    if (!/^[A-Za-z0-9_-]{6,}$/.test(voiceId)) {
      return jsonErr(400, `Ogiltigt voiceId: "${voiceId}".`);
    }

    // ---- Cache-nyckel ----
    const model = "eleven_turbo_v2"; // kan bytas
    const format = "mp3_44100_128";  // ElevenLabs audio_format
    const key = await sha1(`${voiceId}::${model}::${format}::${text}`);

    // ---- Försök hämta från cache ----
    total++;
    const cached = await env.BN_AUDIO.get(key);
    if (cached) {
      hits++;
      return new Response(await cached.arrayBuffer(), {
        status: 200,
        headers: {
          "content-type": "audio/mpeg",
          "cache-control": "public, max-age=31536000, immutable",
          "x-tts-hits": String(hits),
          "x-tts-total": String(total),
          "x-tts-voice-id": voiceId
        }
      });
    }

    // ---- Skapa TTS hos ElevenLabs ----
    const apiUrl = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
      voiceId
    )}`;
    const payload = {
      model_id: model,
      text,
      // Justera tempo/intonation om du vill fintrimma svenska
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.75,
        style: 0.2,
        use_speaker_boost: true
      },
      // MP3 med 44.1k/128kbit. Byt om du vill.
      audio_format: format
    };

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "xi-api-key": env.ELEVENLABS_API_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await safeText(res);
      return jsonErr(
        res.status,
        `ElevenLabs fel (${res.status}): ${errText || res.statusText}`
      );
    }

    const mp3 = await res.arrayBuffer();

    // ---- Spara i cache ----
    try {
      await env.BN_AUDIO.put(key, mp3, {
        httpMetadata: { contentType: "audio/mpeg" },
        customMetadata: {
          voiceId,
          model,
          created_at: new Date().toISOString()
        }
      });
    } catch (_) {
      // Ignorera cachefel – vi vill inte blocka ljudet
    }

    // ---- Svar till klient ----
    return new Response(mp3, {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": "public, max-age=31536000, immutable",
        "x-tts-hits": String(hits),
        "x-tts-total": String(total),
        "x-tts-voice-id": voiceId
      }
    });
  } catch (e) {
    return jsonErr(500, `TTS-crash: ${e?.message || e}`);
  }
};

// ---- Hjälpare ----
const jsonErr = (status, message) =>
  new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "content-type": "application/json" }
  });

const safeText = async (res) => {
  try {
    const t = await res.text();
    return t?.slice(0, 1000);
  } catch {
    return "";
  }
};

async function sha1(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-1", buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
