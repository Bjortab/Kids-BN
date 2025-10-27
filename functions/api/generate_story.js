/**
 * BN Kids v1 — Story GC
 * Förbättrad berättelsekvalitet + kantcache (caches.default) utan extra bindings.
 * Backwards-kompatibel med tidigare frontend:
 *   - tar "ageRange" eller "age"
 *   - tar "heroName"  eller "hero"
 *   - tar "prompt"
 *
 * Miljö:
 *   - OPENAI_API_KEY  (föredras)
 *   - annars fallback via OpenRouter (OPENROUTER_API_KEY)
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "meta-llama/llama-3.1-8b-instruct:free"; // fallback

// Ålderskontroller: längd (ord), stil och ton
function ageControls(age) {
  switch ((age || "").trim()) {
    case "1-2":
      return {
        minWords: 60,  maxWords: 90,
        style: "pekbok; enkla ord; 1–2 korta meningar per scen; trygg rytm",
        rules: [
          "Ultrakorta meningar (max 6 ord).",
          "Beskriv bara 3–4 enkla händelser.",
          "Inga kapitelrubriker, bara en kort löpande text.",
          "Naturligt tryggt slut (sova, kram, god natt)."
        ]
      };
    case "3-4":
      return {
        minWords: 180, maxWords: 320,
        style: "igenkänning, humor, vardagsmagi; tydlig början–mitt–slut",
        rules: [
          "En enkel konflikt som löses lugnt.",
          "Undvik klyschor som 'vänskap besegrar allt'.",
          "Naturligt, konkret slut (”de åt pannkakor och somnade nöjda”)."
        ]
      };
    case "5-6":
      return {
        minWords: 300, maxWords: 500,
        style: "problem–lösning; små ledtrådar; varm ton",
        rules: [
          "Bygg en liten båge med en twist.",
          "Undvik moralpredikan.",
          "Avsluta med en lugn upplösning kopplad till huvudtråden."
        ]
      };
    case "7-8":
      return {
        minWords: 550, maxWords: 900,
        style: "äventyr/mysterium; val och konsekvens; fart utan stress",
        rules: [
          "Skapa nerv med konkreta hinder.",
          "Lösningen ska komma från hjälten, inte slump.",
          "Avsluta i mål, undvik epilog-klichéer."
        ]
      };
    case "9-10":
      return {
        minWords: 900, maxWords: 1300,
        style: "mer dramatik; smarta vändningar; lite humor",
        rules: [
          "Sätt upp en tydlig insats.",
          "Minst ett taktiskt val som påverkar slutet.",
          "Snygg, självklar sista mening som knyter ihop."
        ]
      };
    case "11-12":
      return {
        minWords: 1200, maxWords: 1700,
        style: "coolt, modigt, visuellt; större båge; högre tempo",
        rules: [
          "Konflikten ska växla upp i mitten.",
          "Hjälten vinner med list/kreativitet, inte magiskt deus ex.",
          "Sista stycket ska kännas 'klart', inte som en lärdomspoesi."
        ]
      };
    default:
      return {
        minWords: 300, maxWords: 600,
        style: "familjevänlig; tydlig början–mitt–slut",
        rules: [
          "Naturlig, konkret upplösning.",
          "Undvik floskler och generiska slutfraser."
        ]
      };
  }
}

function buildSystemPrompt(ageCtl) {
  const baseRules = [
    "Skriv på naturlig, idiomatisk svenska.",
    "Inga vuxna/olämpliga teman; trygg och barnanpassad nivå.",
    "Inga upprepade fraser; undvik floskler.",
    "Visa i scener/handling, inte moralisera.",
    "Avsluta med ett konkret, tillfredsställande slut som knyter ihop huvudtråden.",
  ];
  const rules = [...baseRules, ...ageCtl.rules].map(r => `- ${r}`).join("\n");
  return [
    `Du är en erfaren barnboksförfattare.`,
    `Stil: ${ageCtl.style}.`,
    `Längd: ${ageCtl.minWords}–${ageCtl.maxWords} ord (hårt mål).`,
    `Skriv en fokuserad berättelse med röd tråd.`,
    `Regler:\n${rules}`
  ].join("\n");
}

function buildUserPrompt({ prompt, hero, age }) {
  const bits = [];
  if (hero) bits.push(`Hjälte/huvudfigur: ${hero}.`);
  if (prompt) bits.push(`Sagognista (önskat tema/innehåll): ${prompt}.`);
  bits.push(`Målålder: ${age}.`);
  bits.push("Skriv EN sammanhängande berättelse. Ingen extrainstruktion i svaret, bara sagan.");
  // 1–2 särskilt enkelt:
  if (age === "1-2") bits.push("Extra för 1–2: ultrakorta meningar, 3–4 scener, tryggt godnatt-slut.");
  return bits.join("\n");
}

// Väljer OpenAI om möjligt; annars OpenRouter fallback
async function callLLM({ env, messages, maxTokens, temperature }) {
  if (env.OPENAI_API_KEY) {
    const body = {
      model: "gpt-4o-mini",
      messages,
      temperature,
      max_tokens: maxTokens
    };
    const r = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text().catch(()=>r.statusText)}`);
    const j = await r.json();
    return j?.choices?.[0]?.message?.content?.trim() || "";
  }

  // Fallback
  if (!env.OPENROUTER_API_KEY) throw new Error("Saknar OPENAI_API_KEY och OPENROUTER_API_KEY");
  const body = {
    model: OPENROUTER_MODEL,
    messages,
    temperature,
    max_tokens: maxTokens
  };
  const r = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://bn-kids.pages.dev",
      "X-Title": "BN Kids"
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${await r.text().catch(()=>r.statusText)}`);
  const j = await r.json();
  return j?.choices?.[0]?.message?.content?.trim() || "";
}

// Skapar en stabil cache-nyckel (ingen extra binding behövs)
function makeCacheKey({ age, hero, prompt }) {
  const key = `/api/generate_story::v1::age=${(age||"").trim()}::hero=${(hero||"").trim()}::prompt=${(prompt||"").trim()}`;
  return new Request(key);
}

export async function onRequestPost({ request, env }) {
  try {
    const input = await request.json().catch(()=> ({}));
    // bakåtkompatibla fältnamn
    const age = (input.age || input.ageRange || "5-6").trim();
    const hero = (input.hero || input.heroName || "").trim();
    const prompt = (input.prompt || "").trim();

    // 1) Cache: kolla om vi redan har denna saga
    const cache = caches.default;
    const cacheReq = makeCacheKey({ age, hero, prompt });
    const cached = await cache.match(cacheReq);
    if (cached) {
      // leverera direkt
      return new Response(await cached.text(), {
        headers: {
          "content-type": "application/json",
          "x-bn-cache": "HIT",
          "cache-control": "public, max-age=86400"
        }
      });
    }

    // 2) Bygg prompts
    const ctl = ageControls(age);
    const system = buildSystemPrompt(ctl);
    const user = buildUserPrompt({ prompt, hero, age });

    // Temp lite lägre för högre åldrar (tajtare ton)
    const temperature = age === "1-2" || age === "3-4" ? 0.8
                      : age === "5-6" ? 0.7
                      : 0.6;

    const messages = [
      { role: "system", content: system },
      { role: "user", content: user }
    ];

    // 3) LLM
    const story = await callLLM({
      env,
      messages,
      maxTokens: Math.min(1800, Math.round(ctl.maxWords * 2.2)), // generöst tak
      temperature
    });

    if (!story) throw new Error("Tomt svar från modellen.");

    const payload = JSON.stringify({ ok: true, story });

    // 4) Spara i cache (kant-cache 24h)
    const resp = new Response(payload, {
      headers: {
        "content-type": "application/json",
        "x-bn-cache": "MISS",
        "cache-control": "public, max-age=86400"
      }
    });
    await cache.put(cacheReq, resp.clone());

    return resp;
  } catch (err) {
    return new Response(JSON.stringify({ ok:false, error:String(err) }), {
      status: 500,
      headers: { "content-type":"application/json" }
    });
  }
}

export function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}
