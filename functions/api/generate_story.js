// functions/api/generate_story.js
// POST /api/generate_story  -> { childName, heroName, ageRange, prompt, controls:{minWords,maxWords,tone,chapters}, read_aloud }
// Returnerar { ok:true, story }

export const onRequestPost = async ({ request, env }) => {
  try {
    const apiKey = env.OPENAI_API_KEY;
    const model  = env.STORY_MODEL || "gpt-4o-mini";
    if (!apiKey) return j({ ok:false, error:"Saknar OPENAI_API_KEY" }, 500);

    const inb = await request.json();
    const childName = (inb.childName||"").trim();
    const heroName  = (inb.heroName||"").trim();
    const age       = (inb.ageRange||"").trim();
    const prompt    = (inb.prompt||"").trim();
    const ctrls     = inb.controls || { minWords:250, maxWords:500, tone:"barnvänlig", chapters:1 };

    // Säkerhetsräcken
    const minW = clamp(+ctrls.minWords||250, 40, 3000);
    const maxW = Math.max(minW+20, clamp(+ctrls.maxWords||500, 80, 5000));
    const chapters = clamp(+ctrls.chapters||1, 1, 5);
    const tone = (ctrls.tone||"barnvänlig").slice(0,180);

    // Instruktioner för naturliga slut (per ålder)
    const endingGuide = naturalEndingForAge(age);

    // 1–2 år: stöd för “BYT SIDA” men inte efter varje rad
    const pageBreakGuide = age.startsWith("1-2")
      ? "Använd markören [BYT SIDA] sparsamt (ungefär var tredje-kvart mening), endast när en tydlig bildidé byts."
      : "Använd INTE [BYT SIDA].";

    const sys = [
      "Du skriver barnberättelser på **svenska** för BN’s Sagovärld.",
      "Skriv med tydlig, enkel svenska anpassad för åldern. Undvik vuxna klichéer.",
      "Respektera längdintervall och kapitelantal om det anges.",
      "Om ett namn är angivet (barn eller hjälte), väv in det utan att låsa in det i framtida berättelser.",
      "Berättelsen ska ha en tydlig början, mitt och ett **naturligt slut**. Ingen pliktskyldig 'och allt var bra'-fras.",
      "Undvik moraliska föreläsningar. Visa handling → konsekvens i stället.",
      "Skriv alltid i **svenska**; inga engelska fraser."
    ].join("\n");

    const user = [
      `Barnets namn: ${childName || "(ej angivet)"}`,
      `Hjälte: ${heroName || "(ej angiven)"}`,
      `Ålder: ${age}`,
      `Ton: ${tone}`,
      `Kapitel: ${chapters}`,
      `Längd: ${minW}–${maxW} ord`,
      pageBreakGuide,
      endingGuide,
      "",
      `Sagognista: ${prompt || "(fri tolkning inom barnvänliga ramar)"}`
    ].join("\n");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role:"system", content: sys },
          { role:"user",   content: user }
        ],
        temperature: 0.8,
        max_tokens: 1500
      })
    });

    if (!res.ok) {
      const txt = await res.text().catch(()=> "");
      return j({ ok:false, error:`OpenAI ${res.status}: ${txt}` }, 502);
    }
    const data = await res.json();
    let story = (data.choices?.[0]?.message?.content || "").trim();

    // Städa upp: inga dubbla rubriker, inga klyschiga slutfraser
    story = cleanupStory(story, age);

    return j({ ok:true, story }, 200);
  } catch (e) {
    return j({ ok:false, error: String(e?.message || e) }, 500);
  }
};

function j(obj, status=200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type":"application/json; charset=utf-8" }
  });
}
const clamp = (n,min,max) => Math.min(max, Math.max(min, n));

function naturalEndingForAge(age) {
  if (age.startsWith("1-2")) {
    return [
      "SLUT: Lägg sista raden som en lugn, trygg bild (t.ex. 'Pelle sover gott med sin nalle.').",
      "Inget 'Solen föll stilla...' eller vuxen slutkliché."
    ].join(" ");
  }
  if (age.startsWith("11-12")) {
    return [
      "SLUT: Ge en kort payoff kopplad till konflikten och en antydan om konsekvens (utan moralkaka).",
      "Ingen förenklad 'vänner löser allt'-slutfras."
    ].join(" ");
  }
  return "SLUT: Låt sista stycket avrunda händelsen på ett naturligt, lågmält sätt – undvik klyschor.";
}

function cleanupStory(s, age) {
  let out = String(s||"");

  // Tvinga bort engelska markörer/rubriker
  out = out.replace(/^#+\s*/gm, "");

  // Ta bort “Solen föll stilla …” och liknande
  out = out.replace(/Solen föll stilla.*?\.\s*$/is, "");

  // 1–2 år: tillåt [BYT SIDA], men vänta gärna 2–4 meningar
  if (!age.startsWith("1-2")) {
    out = out.replace(/\[BYT SIDA\]/gi, "");
  }

  // Whitespace
  out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return out;
}
