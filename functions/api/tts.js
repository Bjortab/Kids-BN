// functions/api/tts.js
// === GOLDEN COPY v1.1 – Google-first TTS for Cloudflare Pages Functions ===
// Förbättringar:
// - R2-binding: använder env["bn-audio"] med fallback till env.BN_AUDIO (matchar ditt projektnamn).
// - Robust languageCode-härledning från voice.
// - Vary: Origin i CORS för bättre cache-beteende.
// - Bättre fel/logg vid avsaknad av audioContent.
// - SSML-stöd (valfritt).

export async function onRequest(context) {
  const { request, env } = context;

  // ----- CORS -----
  const origin = env.KIDSBN_ALLOWED_ORIGIN || '*';
  const CORS_BASE = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  };
  const jsonResp = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { ...CORS_BASE, 'Content-Type': 'application/json' }
    });

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_BASE });
  }
  if (request.method !== 'POST') {
    return jsonResp({ ok: false, error: 'Method not allowed' }, 405);
  }

  // ----- Helpers -----
  function base64ToArrayBuffer(base64) {
    if (!base64) return new ArrayBuffer(0);
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  async function sha256hex(s) {
    const enc = new TextEncoder().encode(s);
    const h = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Hämta R2-binding (ditt projekt heter "bn-audio")
  function getR2() {
    return env['bn-audio'] || env.BN_AUDIO || null;
  }
  // backoff-retries för upstream
  async function fetchWithRetries(url, opts = {}, retries = 3, baseDelay = 300) {
    for (let i = 0; i <= retries; i++) {
      try {
        const r = await fetch(url, opts);
        if ([429, 502, 503, 504].includes(r.status)) {
          if (i === retries) return r;
          await new Promise(res => setTimeout(res, baseDelay * Math.pow(2, i)));
          continue;
        }
        return r;
      } catch (err) {
        if (i === retries) throw err;
        await new Promise(res => setTimeout(res, baseDelay * Math.pow(2, i)));
      }
    }
  }
  function deriveLanguageCode(voiceName) {
    // ex: "sv-SE-Wavenet-A" -> "sv-SE"
    if (!voiceName) return 'sv-SE';
    const parts = voiceName.split('-');
    if (parts.length >= 2 && parts[0].length === 2 && parts[1].length === 2) {
      return `${parts[0]}-${parts[1]}`;
    }
    // fallback
    if (voiceName.toLowerCase().startsWith('sv')) return 'sv-SE';
    return 'sv-SE';
  }

  // ----- Read body (json/form/plain) -----
  try {
    const ct = (request.headers.get('content-type') || '').toLowerCase();
    let text = '';
    let parsed = {};
    if (ct.includes('application/json')) {
      parsed = await request.json().catch(() => ({}));
      text = parsed?.text || parsed?.message || '';
    } else if (ct.includes('text/plain')) {
      text = await request.text().catch(() => '');
    } else {
      const form = await request.formData().catch(() => null);
      if (form) text = form.get('text') || form.get('message') || '';
      if (!text) {
        try { text = (new URL(request.url)).searchParams.get('text') || ''; } catch (e) {}
      }
    }
    text = (text || '').toString().trim();
    const voice = (
      parsed?.voice ||
      (new URL(request.url)).searchParams.get('voice') ||
      env.GOOGLE_TTS_VOICE ||
      'sv-SE-Wavenet-A'
    ).toString();
    const ssml = (parsed?.ssml || '').toString().trim(); // valfritt

    if (!text && !ssml) return jsonResp({ ok: false, error: 'Missing text (or ssml)' }, 400);

    // ----- R2 cache key -----
    const norm = ((text || '') + '|' + voice).replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 10000);
    const hash = await sha256hex(norm);
    const r2Key = `tts/${hash}.mp3`;

    // ----- R2 cache read -----
    const R2 = getR2();
    if (R2) {
      try {
        const existing = await R2.get(r2Key);
        if (existing) {
          const ctCached =
            (existing.httpMetadata && existing.httpMetadata.contentType) ? existing.httpMetadata.contentType : 'audio/mpeg';
          const headers = { ...CORS_BASE, 'Content-Type': ctCached, 'Cache-Control': 'public, max-age=31536000, immutable' };
          return new Response(existing.body, { status: 200, headers });
        }
      } catch (e) {
        console.warn('[tts] R2 read error', e);
      }
    }

    // ----- Primary: Google Cloud TTS REST -----
    if (env.GOOGLE_TTS_API_KEY) {
      try {
        const googleUrl = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${env.GOOGLE_TTS_API_KEY}`;
        const languageCode = deriveLanguageCode(voice);
        const payload = ssml
          ? { input: { ssml }, voice: { languageCode, name: voice }, audioConfig: { audioEncoding: 'MP3', speakingRate: (parsed?.speakingRate || 1.0) } }
          : { input: { text }, voice: { languageCode, name: voice }, audioConfig: { audioEncoding: 'MP3', speakingRate: (parsed?.speakingRate || 1.0) } };

        const res = await fetchWithRetries(googleUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }, 3, 400);

        if (res && res.ok) {
          const data = await res.json().catch(() => null);
          const b64 = data?.audioContent || '';
          if (!b64) {
            console.error('[tts] Google returned no audioContent. Response:', JSON.stringify(data)?.slice(0, 800));
          } else {
            const audioBuf = base64ToArrayBuffer(b64);
            // Spara i R2 (best-effort)
            try {
              if (R2) await R2.put(r2Key, audioBuf, { httpMetadata: { contentType: 'audio/mpeg' } });
            } catch (e) { console.warn('[tts] R2 write failed', e); }
            const headers = { ...CORS_BASE, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=31536000, immutable' };
            return new Response(audioBuf, { status: 200, headers });
          }
        } else {
          const txt = await (res ? res.text().catch(() => '(no body)') : Promise.resolve('(no response)'));
          console.error('[tts] Google TTS failed', res ? res.status : 'no-res', txt?.slice ? txt.slice(0, 800) : txt);
          // fall-through to fallback
        }
      } catch (e) {
        console.warn('[tts] Google TTS error', e);
      }
    }

    // ----- Fallback: generic TTS endpoint -----
    if (env.TTS_ENDPOINT) {
      try {
        const hdrs = { 'Content-Type': 'application/json' };
        if (env.TTS_API_KEY) hdrs['Authorization'] = `Bearer ${env.TTS_API_KEY}`;
        const res = await fetchWithRetries(env.TTS_ENDPOINT, {
          method: 'POST',
          headers: hdrs,
          body: JSON.stringify({ text, voice, ssml })
        }, 3, 400);

        if (res && res.ok) {
          const arr = await res.arrayBuffer();
          const ct = res.headers.get('Content-Type') || 'audio/mpeg';
          try { if (R2) await R2.put(r2Key, arr, { httpMetadata: { contentType: ct } }); } catch (e) { console.warn('[tts] R2 put failed', e); }
          const headers = { ...CORS_BASE, 'Content-Type': ct, 'Cache-Control': 'public, max-age=31536000, immutable' };
          return new Response(arr, { status: 200, headers });
        } else {
          const txt = await (res ? res.text().catch(() => '(no body)') : Promise.resolve('(no response)'));
          console.error('[tts] generic provider failed', res ? res.status : 'no-res', txt?.slice ? txt.slice(0, 800) : txt);
        }
      } catch (e) {
        console.warn('[tts] generic provider error', e);
      }
    }

    // ----- Inget ljud från någon provider -----
    return jsonResp({
      ok: false,
      error: 'No TTS provider produced audio',
      note: 'Set GOOGLE_TTS_API_KEY or TTS_ENDPOINT/TTS_API_KEY. R2 binding recommended for caching.',
      available_env: {
        GOOGLE_TTS: !!env.GOOGLE_TTS_API_KEY,
        TTS_ENDPOINT: !!env.TTS_ENDPOINT,
        R2_BOUND: !!getR2()
      }
    }, 500);

  } catch (err) {
    console.error('[tts] unexpected', err);
    return jsonResp({ ok: false, error: 'Internal server error', detail: String(err) }, 500);
  }
}
