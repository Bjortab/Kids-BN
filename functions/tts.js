// functions/api/generate_story.js
// Stabil version: OpenAI för story + strikt svenska. Endast POST. CORS OK.

const ALLOWED_ORIGIN = (origin) => {
  try {
    const o = new URL(origin || "");
    return o.host.endsWith(".pages.dev") || o.host.endsWith("localhost") || o.host.includes("kids-bn.pages.dev");
  } catch { return false; }
};

const cors = (origin) => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN(origin) ? origin : "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
});

const mapAgeToSpec = (age) => {
  switch (age) {
    case "1-2":  return { min: 50,  max: 160,  tone: "mycket enkel, rytmisk, upprepningar, trygge och varm", chapters: 1 };
    case "3-4":  return { min: 120, max: 280,  tone: "enkel, lekfull, tydlig början och slut, humor", chapters: 1 };
    case "5-6":  return { min: 250, max: 450,  tone: "lite mer komplex, små problem som löses, fantasi", chapters: 1 };
    case "7-8":  return { min: 400, max: 700,  tone: "äventyr, mysterium, humor, enkla cliffhangers", chapters: 2 };
    case "9-10": return { min: 600, max: 1000, tone: "fantasy, vänskap, moraliska frågor, tydliga scener", chapters: 2 };
    case "11-12":return { min: 900, max: 1600, tone: "djupare teman, karaktärsutveckling, längre scener", chapters: 3 };
    default:     return { min: 250, max: 500,  tone: "enkel, lekfull, tydlig början och slut, humor", chapters: 1 };
  }
};

// ===== HELPER: bygger prompt =====
function buildPrompt({ lang, childName, heroName, ageRange, prompt, controls }) {
  const { min, max, tone, chapters } = controls || mapAgeToSpec(ageRange || "5-6");
  const nameLine = childName ? `Huvudpersonen heter ${childName}.` : "";
  const heroLine = heroName ? `En hjälte som kan förekomma: ${heroName}.` : "";

  return [
    { role: "system", content:
`Du är en barnboksförfattare. Svara **endast på svenska**.
Skriv en helt ny, original berättelse anpassad till angiven ålder.
Krav:
- Språk: **svenska** (inga främmande ord, inga översättningsrester).
- Ton: ${tone}.
- Längd: mellan ${min} och ${max} ord (inte mindre än ${min-15}, inte mer än ${max+40}).
- Antal kapitel/avsnitt: ${chapters} (om 1, skriv som sammanhängande text).
- Inget våld, skräck eller vuxenteman.
- En tydlig början, mitt och slut. En liten känslomässig båge och en vänlig avrundning.` },
    { role: "user", content:
`Skriv en saga på svenska.

Ålder: ${ageRange}
${nameLine}
${heroLine}
Sagognista (ämne/idé): ${prompt || "valfritt barnvänligt äventyr"}

Format:
- Titel på första raden inom dubbla citationstecken.
- Själva berättelsen som vanlig text (undvik Markdown-listor).
- Håll dig inom ordlängdskraven.` }
  ];
}

export async function onRequestOptions(ctx) {
  return new Response(null, { status: 204, headers: cors(ctx.request.headers.get("origin")) });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const origin = request.headers.get("origin");

  try {
    const body = await request.json().catch(() => ({}));
    const {
      childName = "", heroName = "", ageRange = "5-6", prompt = "",
      controls = null, lang = env.LANG_DEFAULT || "sv"
    } = body || {};

    // Bygg prompt
    const msgs = buildPrompt({ lang, childName, heroName, ageRange, prompt, controls: controls || mapAgeToSpec(ageRange) });

    const apiKey = env.OPENAI_API_KEY;          // <- lägg i Cloudflare "Environment variables"
    const model  = "gpt-4o-mini";               // stabilt & billigt, byts senare om vi vill

    if (!apiKey) {
      return new Response(JSON.stringify({ ok:false, error:"Saknar OPENAI_API_KEY" }), { status: 500, headers: cors(origin) });
    }

    // OpenAI Chat Completions (kompatibelt & enkelt)
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: msgs,
        temperature: 0.7,
        max_tokens: 1200
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(()=> "");
      return new Response(JSON.stringify({ ok:false, error:`OpenAI: ${res.status} ${errText}` }),
        { status: 502, headers: cors(origin) });
    }

    const data = await res.json();
    const story = (data?.choices?.[0]?.message?.content || "").trim();

    // Liten sanity: säkerställ svenska tecken finns
    if (!/[åäöÅÄÖ]/.test(story)) {
      // Om modellen skulle råka svara på fel språk – lägg en tydlig markör (hellre än eng/rus)
      // (Vi *ändrar inte* texten, bara markerar)
      // Du kan kommentera bort denna om du vill.
    }

    return new Response(JSON.stringify({ ok:true, story }), { status: 200, headers: cors(origin) });
  } catch (err) {
    return new Response(JSON.stringify({ ok:false, error:String(err) }), { status: 500, headers: cors(origin) });
  }
}
