// functions/api/generate_story.js
// BN Kids Story v2 – åldersprofiler, slutgaranti, inget oönskat “minne”
// Kräver: env.OPENAI_API_KEY (OpenAI). Du kan sätta env.OPENAI_MODEL annars används gpt-4o-mini.

const DEFAULT_MODEL = "gpt-4o-mini";

// ---- CORS ----
function allowed(origin) {
  try {
    const u = new URL(origin || "");
    return u.hostname === "localhost" || u.host.endsWith(".pages.dev");
  } catch { return false; }
}
function cors(origin) {
  return {
    "Access-Control-Allow-Origin": allowed(origin) ? origin : "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json; charset=utf-8",
  };
}
export async function onRequestOptions(ctx) {
  return new Response(null, { status: 204, headers: cors(ctx.request.headers.get("origin")) });
}

// ---- ÅLDERSPROFILER ----
function profile(age) {
  switch (age) {
    case "1-2":
      return {
        maxWords: 65,
        chapters: 1,
        style: `Skriv som en bilderbok för 1–2 år: mycket enkla meningar, ljudord, upprepningar och trygghet.
Använd “BYT SIDA” för att markera sidbrytningar (t.ex. “Pelle vaknar. BYT SIDA Pelle äter. BYT SIDA …”).
Undvik abstrakta ord. Konkreta verb, konkreta saker. Rim och ljud är välkomna.`,
        arc: `Början: trygg vardagsscen. 
Mitten: liten, snäll överraskning (inget farligt).
Slut: lugn, mysig återgång (godnatt/trygghetsfras).`,
      };
    case "3-4":
      return {
        maxWords: 180,
        chapters: 1,
        style: `Enkel, färgrik saga med upprepningar, humor och små cliffhangers.
Korta meningar. Ljud- och färgord. En liten konflikt som löses snällt.`,
        arc: `Början: något tokigt händer.
Mitten: hjälten provar 2–3 enkla lösningar.
Slut: rolig men trygg upplösning.`,
      };
    case "5-6":
      return {
        maxWords: 350,
        chapters: 1,
        style: `Kort äventyr med tydlig konflikt och lösning. Humor + hjärta.
Meningar får vara något längre men behåll klarhet och tempo.`,
        arc: `Början: vardag + problem.
Mitten: hinder + smart idé.
Slut: belönande scen (inte moralpredikan).`,
      };
    case "7-8":
      return {
        maxWords: 650,
        chapters: 2,
        style: `Äventyr och mysterium. Låt hjälten agera, inte bara reagera.
Dialoger, smart problemlösning, ett litet oväntat inslag.`,
        arc: `Kap 1: krok + uppdrag + hinder.
Kap 2: vändning + lösning i scen + efterglöd.`,
      };
    case "9-10":
      return {
        maxWords: 950,
        chapters: 2,
        style: `Mer handling, tydlig motståndare, lagom allvar och mod.
Dialog, taktik, samarbete. Filmisk känsla utan våldsskildring.`,
        arc: `Kap 1: hot/mysterium + plan + första prövning.
Kap 2: motdrag + risk + konkret slutscen som landar i hopp.`,
      };
    case "11-12":
      return {
        maxWords: 1400,
        chapters: 3,
        style: `Actiondrivet, mognare språk, moraliska val.
Konkreta fiender/hinder (inte diffust “mörker”). Undvik klyschor.
Ingen föreläsning om “kärlek löser allt”; visa mod, smarthet, ansvar i scener.`,
        arc: `Kap 1: hot + mål + beslut.
Kap 2: vändpunkt + bakslag + ny plan.
Kap 3: klimax i scen + efterklang med känsla (inte predikan).`,
      };
    default:
      return {
        maxWords: 400,
        chapters: 1,
        style: `Barnvänlig saga med tydlig början, mitten och slut.`,
        arc: `Problem → försök → lösning i scen.`,
      };
  }
}

// ---- PROMPTBYGGARE ----
function buildMessages({ ageRange, childName, heroName, prompt }) {
  const p = profile(ageRange);
  const childLine = childName ? `Barnets namn (kan nämnas 0–2 gånger): ${childName}.` : `Barnets namn är okänt – nämn inte ett specifikt barnnamn.`;
  const heroLine  = heroName  ? `Hjältens namn: ${heroName}. Använd detta namn konsekvent.` : `Om en hjälte behövs, uppfinn ett nytt namn. Återanvänd inte namn från tidigare berättelser.`;

  const constraints = `
Skriv på genuin svenska (inte översatt engelska), i en berättande ton som passar åldern ${ageRange}.
Undvik klyschor som “kärlek segrar allt”. Visa i scener hur mod, vänskap och smarthet fungerar.
Använd konkreta detaljer (ljus, ljud, rörelse). Motståndaren/hindret ska vara konkret.
Avsluta ALLTID med en riktig, scenisk slutbild (2–4 meningar) där konflikten landar.
Överskrid inte ~${p.maxWords} ord totalt. Strukturera i ${p.chapters} kapitel.`;

  const ageSpecific = `
STIL/Ton för ${ageRange} år:
${p.style}

DRAMATURGI:
${p.arc}
`;

  return [
    {
      role: "system",
      content:
`Du är en skicklig barnboksförfattare. Du skriver originella, levande sagor som känns filmiska och tydliga för barn i olika åldrar. Du följer alltid struktur och låter hjältar agera och välja – inte bara få “magiska lösningar”.`
    },
    {
      role: "user",
      content:
`Ämne/idé: ${prompt || "fri fantasi inom barnvänlig ram"}.

${childLine}
${heroLine}

${ageSpecific}

${constraints}

FORMATERING:
- Sätt kapitelrubriker som “Kapitel 1: …”, “Kapitel 2: …” osv.
- För åldern 1–2: markera sidbyte med “BYT SIDA” mellan korta meningar.
- Undvik metakommentarer och skriv inte om att du följer instruktioner. Skriv endast berättelsen.`
    }
  ];
}

// ---- OpenAI-anrop ----
async function callOpenAI(env, messages, maxTokens) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY saknas");

  const model = env.OPENAI_MODEL || DEFAULT_MODEL;
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.85,
      max_tokens: maxTokens || 1600,
      presence_penalty: 0.2,
      frequency_penalty: 0.1,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`OpenAI: ${resp.status} ${t}`);
  }
  const j = await resp.json();
  return (j.choices?.[0]?.message?.content || "").trim();
}

// ---- Slutgaranti / sanering ----
function ensureEnding(text) {
  if (!text) return text;
  // Om sista kapitelrubriken finns men texten slutar abrupt → mjuk landning
  const trimmed = text.trim();
  const goodEnd = /slut|somnade|återvände|såg upp mot|log|kände|våg|fred|lugnet|hemma\./i.test(trimmed.slice(-140));
  if (goodEnd) return trimmed;

  // Lägg till en kort “slutbild” utan floskler
  return trimmed + `

Slutscen:
Kvällen föll stilla över världen. En varm vind drog genom träden när allt äntligen lade sig till ro. Hjälten såg sig omkring, andades ut och visste att nästa äventyr en dag skulle komma – men inte i kväll.`;
}

// ---- Handler ----
export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const origin = request.headers.get("origin");
  const headers = cors(origin);

  try {
    const body = await request.json().catch(() => ({}));
    const {
      childName = "",
      heroName = "",        // OBS: bara med om satt → inget “minne”
      ageRange = "5-6",
      prompt = "",
      // read_aloud kan ignoreras här – TTS sker i /tts
    } = body || {};

    const msgs = buildMessages({ ageRange, childName, heroName, prompt });
    // Max tokens baserat på ålder
    const mt = profile(ageRange).maxWords <= 120 ? 500 : 1600;

    let story = await callOpenAI(env, msgs, mt);
    story = ensureEnding(story);

    // (Frivilligt) enkel sanering så inget eko från modellens "meta"
    story = story.replace(/(^|\n)\s*(SYSTEM|USER|ASSISTANT):.*$/gi, "").trim();

    return new Response(JSON.stringify({ ok: true, story }), {
      status: 200, headers
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500, headers
    });
  }
}
