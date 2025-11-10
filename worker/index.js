// worker/index.js
import { assertWithinBudgetOrThrow, addUsage, readUsage } from "./budget-guard.js";

/**
 * Utility: JSON-respons med CORS
 */
function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-max-age": "86400",
    },
  });
}

/**
 * Utility: CORS preflight
 */
function handleOptions(origin = "*") {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-max-age": "86400",
    },
  });
}

/**
 * Utility: säkert parse av JSON-body
 */
async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/**
 * Utility: enkel hash för cache-nycklar
 */
async function sha256(input) {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * ElevenLabs TTS-anrop – returnerar ArrayBuffer med MP3
 */
async function elevenTTS(text, env, voiceId) {
  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ELEVENLABS_API_KEY");
  }
  const voice = voiceId || env.ELEVENLABS_VOICE_ID || "Rachel";
  const modelId = "eleven_multilingual_v2";

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      optimize_streaming_latency: 0,
      output_format: "mp3_44100_128",
    }),
  });

  if (!res.ok) {
    const errTxt = await res.text().catch(() => "");
    throw new Error(`ElevenLabs error ${res.status}: ${errTxt}`);
  }
  return await res.arrayBuffer();
}

/**
 * D1 helpers (anpassad till din stil)
 */
async function ensureUser(env, userId) {
  const q = env.DB.prepare("SELECT id FROM users WHERE id = ? LIMIT 1").bind(userId);
  const row = await q.first();
  if (!row) {
    await env.DB.prepare("INSERT INTO users (id, created_at) VALUES (?, datetime('now'))").bind(userId).run();
  }
}
async function insertCharacter(env, userId, name) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO characters (id, user_id, name, created_at) VALUES (?, ?, ?, datetime('now'))"
  ).bind(id, userId, name).run();
  return id;
}

/**
 * R2 helpers
 */
async function r2Get(env, key) {
  return env.BN_AUDIO.get(key);
}
async function r2Put(env, key, data, contentType = "audio/mpeg") {
  return env.BN_AUDIO.put(key, data, {
    httpMetadata: { contentType },
  });
}

/* ---------------- Kapitelbok handlers ----------------
   Endpoints:
   - POST /api/story/continue
   - POST /api/chapter/save
   - GET  /api/chapters?story_id=...
   Also: server-side filter for age 1-6 controlled by env.ENABLE_AGE_1_6 ('true' to allow 1-6).
----------------------------------------------------- */

async function handleStoryContinue(body, env) {
  const origin = env.BN_ALLOWED_ORIGIN || "*";
  const currentText = (body?.current_text || "").toString().slice(0, 8000);
  const desiredMinutes = Number(body?.desired_minutes || 5);
  const desiredWords = Number(body?.desired_word_count || Math.round(desiredMinutes * 130));
  const maxTokens = Math.min(3500, Math.round(desiredWords * 1.3));

  const OPENAI_KEY = env.OPENAI_API_KEY;
  if (OPENAI_KEY) {
    const system = "Du är en svensk berättelse‑generator för barn 7–15. Skriv ett sammanhängande kapitel i samma stil som tidigare kontext. Ton: trygg äventyr.";
    const user = `Tidigare kontext (kort):\n${currentText.slice(-3000)}\n\nInstruktion: Skriv nästa kapitel på svenska, cirka ${desiredWords} ord. Behåll karaktärer och stil. Svaret ska vara ren text.`;
    try {
      // Budget-guard: räkna tecken för estimation (kan anpassas)
      await assertWithinBudgetOrThrow(env, Math.min(20000, desiredWords * 5));

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || "gpt-4o-mini",
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          max_tokens: maxTokens,
          temperature: 0.8,
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return json({ ok: false, error: `llm_error ${res.status} ${txt}` }, 502, origin);
      }
      const j = await res.json();
      const generated = j?.choices?.[0]?.message?.content || j?.choices?.[0]?.text || "";
      return json({ ok: true, data: { next_chapter_text: generated } }, 200, origin);
    } catch (e) {
      return json({ ok: false, error: String(e) }, 500, origin);
    }
  } else {
    // Mock fallback
    const seeds = [
      "Plötsligt hördes ett konstigt ljud i bakgrunden...",
      "Där, mellan träden, skymtade något som ingen kunde förklara.",
      "Allt verkade normalt — tills himlen färgades lila.",
      "Hon tog ett djupt andetag och gick försiktigt framåt."
    ];
    const seed = seeds[Math.floor(Math.random() * seeds.length)];
    const next = (currentText ? "" : "") + seed + " (fortsättning — mock)";
    return json({ ok: true, data: { next_chapter_text: next } }, 200, origin);
  }
}

async function handleChapterSave(body, env) {
  const origin = env.BN_ALLOWED_ORIGIN || "*";
  const storyId = body?.story_id || crypto.randomUUID();
  const title = (body?.title || "Untitled").toString().slice(0, 500);
  const text = (body?.text || "").toString();
  let chapterIndex = Number.isFinite(body?.chapter_index) ? Number(body.chapter_index) : null;

  if (!text.trim()) return json({ ok: false, error: "text required" }, 400, origin);

  // Ensure story exists (min_age default 7-15 for BN-Future)
  await env.DB.prepare(
    `INSERT OR IGNORE INTO stories (id, title, min_age, max_age, is_age_active, created_at) VALUES (?, ?, 7, 15, 1, CURRENT_TIMESTAMP)`
  ).bind(storyId, title).run();

  if (!chapterIndex) {
    const r = await env.DB.prepare(`SELECT MAX(chapter_index) as max_index FROM chapters WHERE story_id = ?`).bind(storyId).all();
    const maxIndex = r?.results?.[0]?.max_index;
    chapterIndex = (typeof maxIndex === "number") ? (maxIndex + 1) : 1;
  }

  const chapterId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO chapters (id, story_id, chapter_index, text, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(chapterId, storyId, chapterIndex, text).run();

  return json({ ok: true, data: { id: chapterId, story_id: storyId, chapter_index: chapterIndex } }, 200, origin);
}

async function handleGetChapters(req, env) {
  const origin = env.BN_ALLOWED_ORIGIN || "*";
  const url = new URL(req.url);
  const storyId = url.searchParams.get("story_id");
  if (!storyId) return json({ ok: false, error: "story_id required" }, 400, origin);

  const ENABLE_AGE_1_6 = (env.ENABLE_AGE_1_6 === "true");

  // If the story belongs to an age group 1-6 and that group is disabled (is_age_active = 0) and ENABLE_AGE_1_6 is false,
  // then do not return chapters (empty set). We join stories to enforce server-side filter.
  if (!ENABLE_AGE_1_6) {
    const storyRes = await env.DB.prepare(`SELECT min_age, max_age, is_age_active FROM stories WHERE id = ? LIMIT 1`).bind(storyId).all();
    const s = storyRes?.results?.[0];
    if (s) {
      const minAge = s.min_age;
      const maxAge = s.max_age;
      const isActive = s.is_age_active;
      if ((minAge !== null && maxAge !== null) && (minAge <= 6 && maxAge >= 1) && Number(isActive) === 0) {
        // story is in paused 1-6 group -> return empty
        return json({ ok: true, data: [] }, 200, origin);
      }
    }
  }

  const q = `SELECT id, story_id, chapter_index, text, created_at FROM chapters WHERE story_id = ? ORDER BY chapter_index ASC`;
  const res = await env.DB.prepare(q).bind(storyId).all();
  const rows = (res && res.results) ? res.results.map(r => ({
    id: r.id,
    story_id: r.story_id,
    chapter_index: r.chapter_index,
    text: r.text,
    created_at: r.created_at
  })) : [];
  return json({ ok: true, data: rows }, 200, origin);
}

/* ---------------- Existing routes (TTS etc) preserved ---------------- */

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method.toUpperCase();
    const origin = env.BN_ALLOWED_ORIGIN || "*";

    if (method === "OPTIONS") {
      return handleOptions(origin);
    }

    // Character create (unchanged)
    if (pathname === "/api/v1/characters/create" && method === "POST") {
      const body = await readJson(req);
      const name = body?.name || body?.user_id || null;
      const user_id = body?.user_id || crypto.randomUUID();
      if (!name) return json({ error: "name required" }, 400, origin);
      await ensureUser(env, user_id);
      const character_id = await insertCharacter(env, user_id, name);
      return json({ ok: true, user_id, character_id, name }, 200, origin);
    }

    // Admin usage (unchanged)
    if (pathname === "/admin/tts-usage" && method === "GET") {
      const data = await readUsage(env);
      data.sek_spent_est = Math.round(data.sek_spent_est);
      return json(data, 200, origin);
    }

    // TTS generation (unchanged)
    if ((pathname === "/api/tts/generate" || pathname === "/api/v1/tts") && method === "POST") {
      const body = await readJson(req);
      if (!body || typeof body.text !== "string" || body.text.trim().length === 0) {
        return json({ error: "text required" }, 400, origin);
      }
      const text = body.text.trim();
      const voice = body.voice || env.ELEVENLABS_VOICE_ID || "Rachel";
      const key = `tts/${voice}/${await sha256(text)}.mp3`;
      const cached = await r2Get(env, key);
      if (cached) {
        return new Response(cached.body, {
          status: 200,
          headers: {
            "content-type": "audio/mpeg",
            "cache-control": "public, max-age=31536000, immutable",
            "access-control-allow-origin": origin,
          },
        });
      }
      const chars = text.length;
      await assertWithinBudgetOrThrow(env, chars);
      let audioBuf;
      try {
        audioBuf = await elevenTTS(text, env, voice);
      } catch (e) {
        return json({ error: "tts_failed", detail: String(e) }, 502, origin);
      }
      try {
        await r2Put(env, key, audioBuf, "audio/mpeg");
      } catch (e) {
        console.warn("R2 put failed:", e);
      }
      try {
        await addUsage(env, chars);
      } catch (e) {
        console.warn("KV addUsage failed:", e);
      }
      return new Response(audioBuf, {
        status: 200,
        headers: {
          "content-type": "audio/mpeg",
          "access-control-allow-origin": origin,
        },
      });
    }

    // Kapitelbok endpoints
    if (pathname === "/api/story/continue" && method === "POST") {
      const body = await readJson(req);
      return await handleStoryContinue(body, env);
    }
    if (pathname === "/api/chapter/save" && method === "POST") {
      const body = await readJson(req);
      return await handleChapterSave(body, env);
    }
    if (pathname === "/api/chapters" && method === "GET") {
      return await handleGetChapters(req, env);
    }

    // Healthcheck
    if (pathname === "/health" && method === "GET") {
      return json({ ok: true, service: "BN Worker", time: new Date().toISOString() }, 200, origin);
    }

    return json({ error: "not_found", path: pathname }, 404, origin);
  },
};
