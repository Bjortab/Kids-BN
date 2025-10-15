// ============================================================================
// BN KIDS – AUTOMATISK CLAUDE-MODELLHANTERING + SAGOGENERERING
// ============================================================================

// === Claude model resolver (auto-pick latest) ===============================

const CLAUDE_DEFAULT_FALLBACK = "claude-3-5-sonnet-20240620"; // trygg reserv
const CLAUDE_PREFER_BASENAMES = [
  "claude-3-5-sonnet",
  "claude-3-sonnet",
  "claude-3-haiku"
];

// Enkel minnes-cache i Workern (överlever varma instanser)
const MODEL_CACHE_KEY = "__BN__CLAUDE_MODEL_CACHE__";
function getModelCache() {
  if (!globalThis[MODEL_CACHE_KEY]) {
    globalThis[MODEL_CACHE_KEY] = { model: null, expiresAt: 0 };
  }
  return globalThis[MODEL_CACHE_KEY];
}

// Plocka ut YYYYMMDD från modell-id (t.ex. "claude-3-5-sonnet-20240620")
function extractDateSuffix(id) {
  const m = id.match(/-(\d{8})$/);
  return m ? m[1] : null;
}

// Hämta listan av modeller och välj senaste för given bas (ex: "claude-3-5-sonnet")
async function resolveLatestClaudeModel(apiKey, baseNames = CLAUDE_PREFER_BASENAMES) {
  const cache = getModelCache();
  const now = Date.now();
  if (cache.model && cache.expiresAt > now) {
    return cache.model;
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      }
    });

    if (!res.ok) {
      throw new Error("Model list request failed");
    }

    const payload = await res.json();
    const all = Array.isArray(payload?.data) ? payload.data : [];

    for (const base of baseNames) {
      const candidates = all
        .map(x => x?.id)
        .filter(id => typeof id === "string" && id.startsWith(base + "-"))
        .map(id => ({ id, date: extractDateSuffix(id) }))
        .filter(x => x.date);

      if (candidates.length) {
        candidates.sort((a, b) => b.date.localeCompare(a.date));
        const winner = candidates[0].id;
        cache.model = winner;
        cache.expiresAt = now + 10 * 60 * 1000;
        return winner;
      }
    }

    const anySonnet = all.map(x => x?.id).find(id => /^claude-3-5-sonnet-\d{8}$/.test(id || ""));
    if (anySonnet) {
      cache.model = anySonnet;
      cache.expiresAt = now + 10 * 60 * 1000;
      return anySonnet;
    }

    throw new Error("No suitable model found");
  } catch (err) {
    const fallback = CLAUDE_DEFAULT_FALLBACK;
    const cache = getModelCache();
    cache.model = fallback;
    cache.expiresAt = now + 3 * 60 * 1000;
    return fallback;
  }
}

// ============================================================================
// === SAGOGENERERING =========================================================
// ============================================================================

export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = { "content-type": "application/json" };

  try {
    const body = await request.json();
    const {
      childName = "",
      heroName = "",
      ageRange = "",
      prompt = "",
      controls = {},
      read_aloud = true
    } = body || {};

    const lang = env.LANG_DEFAULT || "sv";

    // Bygg "säkert läge" per ålder
    const guard = buildGuard(ageRange, lang);
    const system = buildSystemPrompt(lang);
    const user = buildUserPrompt(lang, childName, heroName, ageRange, prompt, controls, guard);

    // === Välj modell ===
    const apikey = env.ANTHROPIC_API_KEY;
    const cfg = (env.MODEL_CLAUDE || "auto").trim();
    if (!apikey) {
      return new Response(JSON.stringify({ ok: false, error: "Saknar ANTHROPIC_API_KEY" }), { status: 500, headers });
    }

    let model;
    if (cfg === "auto") {
      model = await resolveLatestClaudeModel(apikey);
    } else if (/^\w.+-\d{8}$/.test(cfg)) {
      model = cfg;
    } else {
      model = await resolveLatestClaudeModel(apikey, [cfg, ...CLAUDE_PREFER_BASENAMES]);
    }

    // === ANTHROPIC CALL ===
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apikey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        temperature: 0.7,
        system,
        messages: [{ role: "user", content: user }]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ ok: false, error: err }), { status: 502, headers });
    }

    const data = await res.json();
    const storyText = data?.content?.[0]?.text || "Ingen text genererades.";

    // Returnera sagan
    return new Response(JSON.stringify({ ok: true, story: storyText, model }), {
      status: 200,
      headers
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers });
  }
}

// ============================================================================
// === Hjälpfunktioner (enkla placeholders, håll dina egna versioner) ==========
// ============================================================================

function buildGuard(ageRange, lang) {
  return {
    ageRange,
    lang,
    tone: "barnvänlig"
  };
}

function buildSystemPrompt(lang) {
  return `Du är en sagoberättare som skriver magiska, vänliga sagor för barn på språket "${lang}".`;
}

function buildUserPrompt(lang, childName, heroName, ageRange, prompt, controls, guard) {
  return `Skriv en kort saga på ${lang} för ett barn i åldern ${ageRange}. 
Barnets namn: ${childName || "okänt"}.
Hjälte: ${heroName || "en snäll figur"}.
Berättelsen ska vara ${guard.tone} och handla om: ${prompt}.`;
}
