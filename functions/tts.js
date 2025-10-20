// functions/tts.js
export const onRequestPost = async ({ request, env }) => {
  try {
    const { text, voiceId: clientVoiceId, speed } = await request.json();

    if (!text || typeof text !== "string") {
      return json({ ok:false, error:"No text" }, 400);
    }

    // ---- 1) Rensa text för uppläsning
    const cleaned = sanitizeForTTS(text);

    // ---- 2) Välj röst
    const apiKey = env.ELEVENLABS_API_KEY || "";
    const voiceId = (clientVoiceId && String(clientVoiceId).trim()) ||
                    (env.ELEVENLABS_VOICE_ID && String(env.ELEVENLABS_VOICE_ID).trim()) ||
                    ""; // tomt → fallback

    // ---- 3) Enkel cache-header (vi lämnar R2-objektcachen oförändrad)
    // (du ser i nätverket "x-tts-total" & "x-tts-hits" i väntan på meningscache)
    const total = 1, hits = 0;

    // ---- 4) ElevenLabs om möjligt
    if (apiKey && voiceId) {
      const el = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: cleaned,
          model_id: "eleven_monolingual_v1", // svenska funkar bra här
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.7,
            style: 0.35,
            use_speaker_boost: true
          },
          // tempo: vi “fikar” lite hastighet via generellt stavelsetryck.
          // ElevenLabs har ingen ren speed-knapp, men vi kan korta pauser:
          // lämnar detta då du redan ökade tempot i appen.
        })
      });

      if (!el.ok) {
        const errTxt = await el.text().catch(()=>"");
        // faller tillbaka
      } else {
        const buf = await el.arrayBuffer();
        return new Response(buf, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store",
            "x-tts-total": String(total),
            "x-tts-hits": String(hits)
          }
        });
      }
    }

    // ---- 5) Fallback (webm/opus via Web Speech API i edge-runtime)
    // Returnerar enkel TTS med Cloudflare’s synthesizer (om tillgänglig).
    // Om inte – svara tydligt till klienten.
    if (env.AI) {
      const aiRes = await env.AI.run("@cf/meta/tts", {
        text: cleaned,
        // svensk röst är basic – men bättre än tyst
        voice: "alloy",
        format: "opus"
      });
      return new Response(aiRes, {
        status: 200,
        headers: {
          "Content-Type": "audio/ogg",
          "Cache-Control": "no-store",
          "x-tts-total": String(total),
          "x-tts-hits": String(hits)
        }
      });
    }

    return json({ ok:false, error:"Ingen TTS tillgänglig (varken ElevenLabs eller CF AI)" }, 500);
  } catch (err) {
    return json({ ok:false, error: String(err?.message || err) }, 500);
  }
};

// ---- Hjälpare ----
const json = (obj, status=200, headers={}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type":"application/json; charset=utf-8", ...headers }
  });

// Tar bort [BYT SIDA]-markörer m.m. så de inte läses upp,
// och normaliserar dubbelmellanrum.
function sanitizeForTTS(raw) {
  let s = String(raw || "");

  // ta bort block/etiketter som inte ska läsas
  s = s.replace(/\[BYT\s*SIDA\]/gi, " ");
  s = s.replace(/^###\s*/gm, "");        // md rubriker
  s = s.replace(/^\*\*/gm, "").replace(/\*\*$/gm, "");
  s = s.replace(/--/g, "—");

  // klämkäckt standard-slut → ersätt med mer neutralt
  s = s.replace(
    /Solen föll stilla över världen.*?\.\s*$/is,
    "Och den kvällen var allt lugnt igen."
  );

  // städa whitespace
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}
