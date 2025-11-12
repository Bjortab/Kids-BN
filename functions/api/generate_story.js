// functions/api/generate_story.js
// === GC v1.0 — använder world_state och kräver JSON-svar från modellen ===

export default {
  async fetch(req, env) {
    try {
      const { prompt, world_state, world_summary } = await req.json();

      const system = `
Du är en svensk barnboksförfattare för åldern 7–15. Skriv ett kapitel (ca 300–600 ord).
FÖLJ OBLIGATORISKT:
1) Kausalitet: inga hopp i tid/plats utan övergång. Förklara orsaker innan effekter.
2) Konsekvent värld: behåll namn, mål, plats, tid på dygnet enligt world_state.
3) Inga “floskel-slut” (t.ex. “bring ljus till mörkret”). Avsluta konkret i scenen.
4) Undvik passiva plattityder; visa handlingar och detaljerade konsekvenser.
5) Språk: klar, varierad men enkel svenska (7–15).
6) Absolut inga nya krafter/förmågor utan naturlig foreshadowing.

World state (sammanfattning):
${world_summary}

Om något i användarens prompt strider mot world_state, justera försiktigt men behåll kontinuitet.
Returnera EXAKT detta JSON-schema, inget annat:
{
  "story_text": "själva kapitlet som plain text",
  "world_state_next": {
    "protagonists": ["..."],
    "location": "...",
    "timeOfDay": "...",
    "goal": "...",
    "constraints": { "noSuddenPowers": true, "consistentNames": true, "groundedPhysics": true, "noGenericMoralEnd": true },
    "recap": "1–2 meningar som summerar detta kapitels viktiga förändring"
  }
}
      `.trim();

      // === OpenAI (exempel) ===
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.7,
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt || "" },
            // ge modellen world_state som “assistant context” för att öka tyngden
            { role: "assistant", content: `World state JSON: ${JSON.stringify(world_state || {}, null, 2)}` }
          ]
        })
      });

      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        return json({ ok:false, error:"Model error", detail:t.slice(0,800) }, 502);
      }

      const data = await resp.json();
      const raw = data?.choices?.[0]?.message?.content || "";
      // Förväntar oss ren JSON – försök parsa robust
      const safe = tryParseJSON(raw);
      if (!safe || !safe.story_text) {
        // fallback: om modellen råkade svara text, wrappa den
        return json({
          ok:true,
          data:{
            story_text: typeof raw === "string" ? raw : "Berättelse saknas.",
            world_state_next: world_state || {}
          }
        }, 200);
      }

      // Mergar constraints från inkommande state om modellen skulle tappa dem
      if (safe.world_state_next && world_state?.constraints) {
        safe.world_state_next.constraints = { ...world_state.constraints, ...(safe.world_state_next.constraints||{}) };
      }

      return json({ ok:true, data: safe }, 200);

    } catch (e) {
      return json({ ok:false, error:"Server error", detail:String(e) }, 500);
    }

    function json(obj, status=200) {
      return new Response(JSON.stringify(obj), {
        status,
        headers: { "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" }
      });
    }
    function tryParseJSON(s) {
      try { return JSON.parse(s); } catch { return null; }
    }
  }
};
