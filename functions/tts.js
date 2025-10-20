// functions/tts.js
// BN — TTS med robust R2-binding + hel-berättelse-cache i R2 + text-normalisering

export async function onRequestPost({ request, env }) {
  try {
    // ======= 1) Läs input =======
    const body = await request.json().catch(() => ({}));
    const rawText = (body?.text || '').trim();
    const reqVoiceId = (body?.voiceId || '').trim();
    if (!rawText) {
      return json({ ok: false, error: 'Ingen text skickades.' }, 400);
    }

    // ======= 2) Hämta ElevenLabs-credentials =======
    const EL_API =
      env.ELEVENLABS_API_KEY || env.EL_API || env.ELEVEN_API_KEY;
    const defaultVoice =
      env.ELEVENLABS_VOICE_ID || env.EL_VOICE_ID || '';
    const voiceId = reqVoiceId || defaultVoice || '21m00Tcm4TlvDq8ikWAM'; // fallback

    if (!EL_API) {
      return json({ ok: false, error: 'Saknar ElevenLabs API-nyckel (ELEVENLABS_API_KEY).' }, 500);
    }
    if (!voiceId) {
      return json({ ok: false, error: 'Saknar röst-id. Sätt ELEVENLABS_VOICE_ID eller skicka voiceId i kroppen.' }, 400);
    }

    // ======= 3) R2-binding: hitta bucketen robust =======
    const audioBucket =
      env.BN_AUDIOS ??
      env['bn-audio'] ??
      env.BN_AUDIO ??
      env.AUDIO_BUCKET ??
      null;

    if (!audioBucket || typeof audioBucket.get !== 'function') {
      const keys = Object.keys(env || {}).sort();
      return json({
        ok: false,
        error: 'R2-binding för ljud saknas. Förväntade t.ex. BN_AUDIOS eller "bn-audio".',
        env_keys_preview: keys.slice(0, 60)
      }, 500);
    }

    const lang = (env.LANG_DEFAULT || 'sv').toLowerCase();
    const text = normalizeText(rawText); // 🔑 bättre cache-träffar
    const key = await buildCacheKey({ text, voiceId, lang });

    // ======= 4) Cache: HEAD/GET från R2 =======
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
    } catch (_) {
      // Ignorera, behandla som miss
    }

    // ======= 5) Generera TTS från ElevenLabs =======
    const audioBuffer = await elevenlabsTTS({ apiKey: EL_API, text, voiceId });

    // ======= 6) Spara i R2 (cache write) =======
    try {
      await audioBucket.put(key, audioBuffer, {
        httpMetadata: { contentType: 'audio/mpeg' }
      });
    } catch (_) {
      // leverera ändå
    }

    return new Response(audioBuffer, {
      status: 200,
      headers: {
        'content-type': 'audio/mpeg',
        'x-tts-cache': 'MISS',
        'x-tts-key': key
      }
    });
  } catch (err) {
    return json({ ok: false, error: err?.message || String(err) }, 500);
  }
}

// ================== Hjälpfunktioner ==================

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function normalizeText(raw) {
  // Ta bort [BYT SIDA], rubrikmarkörer, extra whitespace, normalisera citat
  return String(raw || '')
    .replace(/\[BYT SIDA\]/gi, '')
    .replace(/^#+\s*/gm, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function buildCacheKey({ text, voiceId, lang }) {
  const enc = new TextEncoder();
  const data = enc.encode([lang.toLowerCase(), voiceId, text].join('||'));
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `tts/${lang}/${voiceId}/${hex.slice(0, 24)}.mp3`;
}

async function elevenlabsTTS({ apiKey, text, voiceId }) {
  const payload = {
    text, // vi skickar ren text, svensk tolkning hanteras av multilingual v2
    model_id: 'eleven_multilingual_v2',
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.25,
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
