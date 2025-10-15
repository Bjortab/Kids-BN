// functions/api/generate_story.js  — Golden Copy (Claude 3.5 Sonnet)

const CORS = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
});

export async function onRequestOptions(ctx) {
  return new Response(null, { status: 204, headers: CORS(ctx.env?.BN_ALLOWED_ORIGIN) });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const headers = CORS(env?.BN_ALLOWED_ORIGIN);

  try {
    const body = await request.json();
    const {
      childName = "",
      heroName = "",
      ageRange = "",
      prompt = "",
      controls = {},
      read_aloud = true,
      lang = env.LANG_DEFAULT || "sv"  // "sv" eller "en"
    } = body || {};

    const { minWords = 250, maxWords = 500, tone = "barnvänlig", chapters = 1 } = controls || {};

    // Bygg “säkert läge” per ålder (enkelt & tryggt)
    const guard = buildGuard(ageRange, lang);

    // Systeminstruktion: *hur* modellen ska skriva
    const system = buildSystemPrompt(lang);

    // Userprompt: *vad* som ska skrivas (med tydliga ramar)
    const user = buildUserPrompt({
      lang, childName, heroName, ageRange, prompt, minWords, maxWords, tone, chapters, guard
    });

    // === ANTHROPIC CALL ===
    const model = env.MODEL_CLAUDE || "claude-3-5-sonnet-20240620";
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return json({ ok:false, error:"Saknar ANTHROPIC_API_KEY (Secret) i Pages → Settings → Environment variables" }, 500, headers);
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: Math.max(800, Math.min(2200, Math.round(maxWords * 2.3))), // rejält utrymme
        temperature: 0.7,
        system,
        messages: [
          { role: "user", content: user }
        ]
      })
    });

    if (!res.ok) {
      const t = await res.text().catch(()=> "");
      return json({ ok:false, error:`Claude ${res.status}: ${t}` }, 502, headers);
    }

    const data = await res.json();
    const raw = (data?.content?.[0]?.text || "").trim();

    // Postprocess: städa, håll inom längdkorridor
    const story = finalizeStory(raw, { minWords, maxWords, lang });

    return json({ ok:true, story, read_aloud }, 200, headers);

  } catch (err) {
    return json({ ok:false, error: String(err?.message || err) }, 500, headers);
  }
}

/* -------- Helpers -------- */

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type":"application/json; charset=utf-8", ...headers }
  });
}

function buildSystemPrompt(lang) {
  if (lang === "en") {
    return [
      "You are a Swedish children's storyteller switched to ENGLISH MODE.",
      "Write warm, imaginative, **age-appropriate** stories.",
      "Prefer simple, musical sentences; avoid awkward calques.",
      "No violence, horror, bullying, or adult themes.",
      "Keep continuity, names, and settings consistent.",
      "End cleanly without prompts or meta text."
    ].join(" ");
  }
  // Swedish
  return [
    "Du är en barnboksberättare på **svenska**.",
    "Skriv varmt, enkelt och musikaliskt – som en riktigt bra bilderbokstext.",
    "Undvik \"översättningskänsla\"; skriv idiomatisk svenska.",
    "Inga skräckinslag, våld, mobbning eller vuxna teman.",
    "Håll koll på namn och detaljer så allt hänger ihop.",
    "Avsluta tydligt, utan meta-texter eller instruktioner."
  ].join(" ");
}

function buildGuard(ageRange, lang){
  const a = (ageRange || "").trim();
  const isTiny = (a === "1-2" || a === "3-4");

  if (lang === "en") {
    return isTiny
      ? "Use gentle onomatopoeia (whoosh, pling) and repetition. Avoid complex time shifts."
      : "You may add small mysteries or gentle cliffhangers for older kids, but remain kind and safe.";
  }
  // Swedish
  return isTiny
    ? "Använd milda ljudord (vissel, pling), upprepningar och tydliga bilder. Undvik hopp i tid."
    : "För äldre barn kan du lägga in små mysterier eller lätta cliffhangers, men håll allt tryggt och snällt.";
}

function buildUserPrompt({ lang, childName, heroName, ageRange, prompt, minWords, maxWords, tone, chapters, guard }) {
  const nameLine = childName ? (lang === "en" ? `Child's name: ${childName}.` : `Barnets namn: ${childName}.`) : "";
  const heroLine = heroName  ? (lang === "en" ? `Hero's name: ${heroName}.`   : `Hjältens namn: ${heroName}.`)     : "";

  const base = (lang === "en")
    ? [
        `Write a children's bedtime story in ${lang.toUpperCase()} for ages ${ageRange}.`,
        nameLine, heroLine,
        `User theme: ${prompt || "(free imaginative theme)"}.`,
        `Target length: ${minWords}–${maxWords} words. Chapters: ${chapters}.`,
        `Tone and style: ${tone}.`,
        guard,
        "Use short, musical sentences. Show, don't lecture. Keep Swedish cultural equivalents if relevant.",
        "Return **only** the story text. No titles like 'Story:' or 'Once upon a time:' labels.",
        "END_OF_STORY when finished."
      ]
    : [
        `Skriv en godnattsaga på **svenska** för ålder ${ageRange}.`,
        nameLine, heroLine,
        `Ämne: ${prompt || "(fri fantasi)"}.`,
        `Mål-längd: ${minWords}–${maxWords} ord. Kapitel: ${chapters}.`,
        `Ton & stil: ${tone}.`,
        guard,
        "Korta, musikaliska meningar. Visa istället för att berätta rakt ut.",
        "Svara med **endast** sagotexten, inga rubriker eller meta-rader.",
        "Avsluta med: END_OF_STORY"
      ];

  return base.filter(Boolean).join("\n");
}

function finalizeStory(raw, { minWords, maxWords, lang }) {
  let text = raw.replace(/\s*END_OF_STORY\s*$/i, "").trim();

  // Ta bort eventuella kodblock/markeringar
  text = text.replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim();

  // Liten längdkontroll
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > maxWords + 80) {
    // trunkera vid närmaste meningsslut
    const sentences = text.split(/([.!?…]+)\s+/);
    let out = "";
    let count = 0;
    for (let i = 0; i < sentences.length; i += 2) {
      const s = (sentences[i] || "") + (sentences[i+1] ? sentences[i+1] + " " : " ");
      const sc = s.split(/\s+/).filter(Boolean).length;
      if (count + sc > maxWords) break;
      out += s;
      count += sc;
    }
    text = out.trim();
  }

  // För småbarn – lägg in mjukare radbrytningar (läsbarhet)
  if (lang !== "en") {
    text = text.replace(/([.!?…])\s+/g, "$1\n");
  }

  return text.trim();
}
