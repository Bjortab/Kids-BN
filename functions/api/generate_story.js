// functions/api/generate_story_v2.js
// Ny version med genreprofiler per ålder + bildstöd

// --- Importa ev helpers (om du har dem) ---
import { splitToSentences, normalizeSentence } from "../shared/text_utils.js";  
// (alternativ: kopiera in samma kod från tts eller shared)

const ALLOWED_ORIGIN = (origin) => {
  try {
    const u = new URL(origin || "");
    return u.host.endsWith(".pages.dev") || u.hostname === "localhost";
  } catch {
    return false;
  }
};
const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN(origin) ? origin : "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8"
});

function ageProfiles(age) {
  switch (age) {
    case "1-2":
      return {
        toneHint: "mycket enkel, ljud och upprepningar",
        promptIntro: "Pelle taxen vaknar. Vad händer?",
        maxWords: 80, chapters: 1
      };
    case "3-4":
      return {
        toneHint: "färg, ljud, upprepningar men med liten konflikt",
        promptIntro: "Pelle taxen hör ett konstigt ljud utanför huset...",
        maxWords: 180, chapters: 1
      };
    case "5-6":
      return {
        toneHint: "mild spänning, hjälte, enkel konflikt",
        promptIntro: "Pelle taxen tappade sin boll långt in i skogen.",
        maxWords: 350, chapters: 1
      };
    case "7-8":
      return {
        toneHint: "äventyr, hinder, dialog, räddning",
        promptIntro: "Pelle taxen måste skydda en magisk boll mot skuggvarelser.",
        maxWords: 600, chapters: 2
      };
    case "9-10":
      return {
        toneHint: "dialog, prövningar, samarbete",
        promptIntro: "Skogen täcks av tyst dimma, och Pelle taxen får ett viktigt uppdrag.",
        maxWords: 900, chapters: 2
      };
    case "11-12":
      return {
        toneHint: "djupare teman, moraliska val, spänning och konsekvenser",
        promptIntro: "En ond makt hotar jorden – Pelle taxen måste fatta svåra val.",
        maxWords: 1400, chapters: 3
      };
    default:
      return {
        toneHint: "barnvänlig", promptIntro: "", maxWords: 400, chapters: 1
      };
  }
}

function buildPromptV2({ ageRange, childName, heroName, prompt }) {
  const prof = ageProfiles(ageRange);
  const intro = prof.promptIntro;
  const tone = prof.toneHint;

  const nameLine = childName ? `Barnets namn: ${childName}.` : "";
  const heroLine = heroName ? `Hjältens namn: ${heroName}.` : "";

  return [
    { role: "system", content:
`Skriv en saga för barn i åldern ${ageRange} år.  
Ton: ${tone}.  
Ge hjälten ett konkret mål och en antagonist eller hinder.  
Slutet ska variera – ibland triumf, ibland lärdom, ibland val.  
Undvik klyschiga “alla blir lyckliga” slut.` },
    { role: "user", content:
`${intro}  
${nameLine}  
${heroLine}  
Ämne/idé: ${prompt}  
Maximalt ${prof.maxWords} ord, ${prof.chapters} kapitel.` }
  ];
}

export async function onRequestOptions(ctx) {
  return new Response(null, { status: 204, headers: corsHeaders(ctx.request.headers.get("origin")) });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const origin = request.headers.get("origin");

  try {
    const body = await request.json().catch(() => ({}));
    const {
      childName = "", heroName = "", ageRange = "5-6", prompt = ""
    } = body || {};

    const msgs = buildPromptV2({ ageRange, childName, heroName, prompt });

    // Använd samma AI-motor som du redan konfigurerat (OpenAI eller Claude fallback)
    const apiKey = env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ ok:false, error:"Inga API-nycklar konfigurerade" }),
        { status: 500, headers: corsHeaders(origin) });
    }

    // (Använd OpenAI som standard – du kan byta till Claude fallback senare)
    const model = env.OPENAI_MODEL || "gpt-4o-mini";

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.8,
        max_tokens: 1200,
        messages: msgs
      })
    });

    if (!resp.ok) {
      const e = await resp.text().catch(()=> "");
      return new Response(JSON.stringify({ ok:false, error:`AI: ${resp.status} ${e}` }),
        { status: 502, headers: corsHeaders(origin) });
    }

    const j = await resp.json();
    const story = (j.choices?.[0]?.message?.content || "").trim();

    // Hämta bilder via bild-API (om du har implementerat) – optional
    let images = [];
    try {
      const imgRes = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ storyText: story, ageRange, count: 3 })
      });
      if (imgRes.ok) {
        const imgJ = await imgRes.json();
        images = imgJ.images || [];
      }
    } catch {
      images = [];
    }

    return new Response(JSON.stringify({ ok:true, story, images }), {
      status: 200,
      headers: corsHeaders(origin)
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok:false, error:String(err) }), {
      status: 500, headers: corsHeaders(origin)
    });
  }
}
