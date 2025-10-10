// functions/api/generate_story.js
// ─────────────────────────────────────────────────────────────
// Viktigt: exportera OPTIONS + POST överst så Pages/Functions
// säkert registrerar att endpointen accepterar POST.
// ─────────────────────────────────────────────────────────────

export async function onRequestOptions(ctx) {
  const headers = makeCorsHeaders(ctx.env?.BN_ALLOWED_ORIGIN);
  return new Response(null, { status: 204, headers });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const headers = makeCorsHeaders(env?.BN_ALLOWED_ORIGIN);

  try {
    // ── Läs och validera indata ─────────────────────────────
    const body = await request.json().catch(() => ({}));
    const childName = (body.name || "").toString().trim();
    const ageRange  = (body.ageRange || "").toString().trim(); // "1–2" / "3-4" etc.
    const userPrompt = (body.prompt || "").toString().trim();
    const heroName  = (body.heroName || "").toString().trim();

    if (!userPrompt) {
      return json({ ok:false, error:"Saknar prompt." }, 400, headers);
    }

    // ── Åldersstyrd längd/ton ───────────────────────────────
    const spec = mapAgeToSpec(ageRange);

    // ── Bygg författarprompt (svenska) ──────────────────────
    const fullPrompt = buildPrompt({ childName, heroName, userPrompt, spec });

    // ── OpenAI (text) ───────────────────────────────────────
    const apiKey = env?.OPENAI_API_KEY;
    const model  = env?.OPENAI_TEXT_MODEL || "gpt-4o-mini";
    if (!apiKey) {
      return json({ ok:false, error:"OPENAI_API_KEY saknas i miljön." }, 500, headers);
    }

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "Du är en erfaren barnboksförfattare på svenska. " +
              "Skriv åldersanpassade sagor med varm, trygg ton och tydlig början–mitt–slut."
          },
          { role: "user", content: fullPrompt }
        ],
        temperature: 0.8
      })
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      return json({ ok:false, error:`OpenAI-fel: ${aiRes.status} ${t}` }, aiRes.status, headers);
    }

    const data  = await aiRes.json();
    const story = data?.choices?.[0]?.message?.content?.trim() || "";

    return json({
      ok: true,
      story,
      meta: {
        ageRange: spec.label,
        min_words: spec.min,
        max_words: spec.max,
        tone: spec.tone
      }
    }, 200, headers);

  } catch (err) {
    return json({ ok:false, error:`Serverfel: ${String(err)}` }, 500, headers);
  }
}

// ───────────────── Hjälpfunktioner ──────────────────────────

function makeCorsHeaders(allowedOrigin) {
  const origin = allowedOrigin || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers });
}

function mapAgeToSpec(ageRangeRaw) {
  // Acceptera “1–2”, “1-2”, “1–2 år”, etc.
  const cleaned = (ageRangeRaw || "")
    .toLowerCase()
    .replace(/\s|år/g, "")
    .replace("–", "-");

  const table = {
    "1-2":   { min: 60,  max: 150,  tone: "mycket enkel, rytmisk, upprepningar, trygg och varm",         label: "1–2 år" },
    "3-4":   { min: 120, max: 250,  tone: "enkel, lekfull, tydlig början och slut, humor",               label: "3–4 år" },
    "5-6":   { min: 180, max: 350,  tone: "lite mer komplex, små problem som löses, fantasi",            label: "5–6 år" },
    "7-8":   { min: 250, max: 500,  tone: "äventyr, mysterium, humor, enkla cliffhangers",               label: "7–8 år" },
    "9-10":  { min: 350, max: 800,  tone: "fantasy, vänskap, moraliska frågor, tydliga scener",          label: "9–10 år" },
    "11-12": { min: 500, max: 1200, tone: "djupare teman, karaktärsutveckling, längre scener",           label: "11–12 år" }
  };

  return table[cleaned] || table["3-4"];
}

function buildPrompt({ childName, heroName, userPrompt, spec }) {
  const who  = childName ? `Barnet heter ${childName}. ` : "";
  const hero = heroName  ? `Inkludera hjälten "${heroName}" där det passar. ` : "";
  return (
    `${who}${hero}` +
    `Skriv en saga på svenska för åldern ${spec.label}. ` +
    `Tema/önskemål: ${userPrompt}. ` +
    `Ton: ${spec.tone}. ` +
    `Längd: cirka ${spec.min}–${spec.max} ord. ` +
    `Struktur: tydlig början, mitt och slut; varm och trygg känsla; inga läskiga inslag. ` +
    `Använd korta stycken och enkelt språk.`
  );
}
