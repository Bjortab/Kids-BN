// functions/tts.js
// BN — TTS med robust R2-binding + hel-berättelse-cache i R2

export async function onRequestPost({ request, env }) {
  try {
    // ======= 1) Läs input =======
    const body = await request.json().catch(() => ({}));
    const text = (body?.text || '').trim();
    const reqVoiceId = (body?.voiceId || '').trim();
    if (!text) {
      return new Response(JSON.stringify({ ok: false, error: 'Ingen text skickades.' }), { status: 400 });
    }

    // ======= 2) Hämta ElevenLabs-credentials =======
    const EL_API = env.ELEVENLABS_API_KEY || env.EL_API || env.ELEVEN_API_KEY;
    const defaultVoice = env.ELEVENLABS_VOICE_ID || env.EL_VOICE_ID || '';
    const voiceId = reqVoiceId || defaultVoice || '21m00Tcm4TlvDq8ikWAM'; // fallback-röst (Alloy)

    if (!EL_API) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Saknar ElevenLabs API-nyckel (ELEVENLABS_API_KEY).'
      }), { status: 500 });
    }

    // ======= 3) R2-binding: hitta bucketen robust =======
    // Vi accepterar både nya och gamla namn.
    const audioBucket =
      env.BN_AUDIOS ??
      env['bn-audio'] ??
      env.BN_AUDIO ??
      env.AUDIO_BUCKET ??
      null;

    // Hjälptext om binding saknas (listan gör felsökning enkel)
    if (!audioBucket || typeof audioBucket.get !== 'function') {
      const keys = Object.keys(env || {}).sort();
      return new Response(JSON.stringify({
        ok: false,
        error: 'R2-binding för ljud saknas. Förväntade t.ex. BN_AUDIOS eller "bn-audio".',
        env_keys_preview: keys.slice(0, 50) // för att inte spamma
      }), { status: 500 });
    }

    // ======= 4) Nyckel för cache (hela sagan) =======
    const lang = (env.LANG_DEFAULT || 'sv').toLowerCase();
    const key = await buildCacheKey({ text, voiceId, lang });

    // ======= 5) Cache: HEAD/GET från R2 =======
    let cacheHit = false;
    try {
      const head = await audioBucket.head(key);
      if (head) {
        const obj = await audioBucket.get(key);
        if (obj) {
          const buf = await obj.arrayBuffer();
          return new Response(buf, {
            status: 200,
            headers: {
              'content-type': obj.httpMetadata?.contentType || 'audio/mpeg',
              'x-tts-cache': 'HIT',
              'x-tts-key': key
            }
          });
        }
      }
    } catch (e) {
      // Fortsätt – cache miss eller HEAD/GET inte stött i lokalt emu
    }

    // ======= 6) Generera TTS från ElevenLabs =======
    const audioBuffer = await elevenlabsTTS({ apiKey: EL_API, text, voiceId, lang });

    // ======= 7) Spara i R2 (cache write) =======
    try {
      await audioBucket.put(key, audioBuffer, {
        httpMetadata: { contentType: 'audio/mpeg' }
      });
    } catch (_) {
      // Om put misslyckas vill vi ändå leverera ljudet
    }

    cacheHit = false;
    return new Response(audioBuffer, {
      status: 200,
      headers: {
        'content-type': 'audio/mpeg',
        'x-tts-cache': cacheHit ? 'HIT' : 'MISS',
        'x-tts-key': key
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: err?.message || String(err)
    }), { status: 500 });
  }
}

// ================== Hjälpfunktioner ==================

async function buildCacheKey({ text, voiceId, lang }) {
  const enc = new TextEncoder();
  const data = enc.encode([lang, voiceId, text].join('||'));
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  // Kortar key lite för läsbarhet
  return `tts/${lang}/${voiceId}/${hex.slice(0, 16)}.mp3`;
}

async function elevenlabsTTS({ apiKey, text, voiceId, lang }) {
  // Svenska röstning: välj `voice_settings` så det inte går långsamt eller blir ”ryska”
  // Pitch/tempo justeras mild för svenska.
  const payload = {
    text,
    model_id: 'eleven_multilingual_v2', // säker för SV
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.3,
      use_speaker_boost: true
    }
  };

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?optimize_streaming_latency=0&output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`ElevenLabs TTS-fel ${res.status}: ${txt || res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return arrayBuffer;
}
