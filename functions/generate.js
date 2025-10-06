import { corsHeaders, isBlockedPrompt, kidsSystemPrompt, sanitizeOutput } from "./_utils";
import { getUser } from "./_auth";

export async function onRequest(context) {
  const { request, env } = context;
  const mode = (env.KIDSBN_MODE || "mock").toLowerCase();
  const forMock = mode === "mock" || !env.OPENAI_API_KEY;
  const headers = corsHeaders(env, forMock);

  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers: { ...headers, "x-kidsbn-mode": mode } });
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers });

  const user = await getUser(context);
  if(!user) return new Response(JSON.stringify({ error: "UNAUTH" }), { status: 401, headers });

  let body; try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: "BAD_JSON" }), { status: 400, headers }); }
  const prompt = (body?.prompt || "").toString().trim();
  const memory = body?.memory && typeof body.memory === "object" ? {
    hero: (body.memory.hero || "").toString().slice(0, 80),
    facts: Array.isArray(body.memory.facts) ? body.memory.facts.map(x => (x||"").toString().slice(0,120)).slice(0,3) : []
  } : { hero: "", facts: [] };
  if (!prompt) return new Response(JSON.stringify({ error: "EMPTY_PROMPT" }), { status: 400, headers });
  if (isBlockedPrompt(prompt)) {
    const safeMsg = "Det där temat passar inte för barn. Vill du kanske höra om en modig kanin som hittar en hemlig stig, eller en nyfiken robot som lär sig vänskap?";
    return new Response(JSON.stringify({ story: safeMsg }), { status: 200, headers });
  }

  // Entitlement & kvot
  const entKV = env.kidsbn_entitlements;
  const usageKV = env.kidsbn_usage;
  const ent = (await entKV.get(`ent:${user.id}`, "json")) || { plan:"free", tokens_left:0, monthly_quota:8, status:"active" };
  const ym = new Date().toISOString().slice(0,7);
  const used = Number(await usageKV.get(`m:${user.id}:${ym}`)) || 0;

  const quota = ent.monthly_quota ?? (ent.plan==="plus"?100 : ent.plan==="mini"?30 : 8);
  const tokensLeft = ent.tokens_left || 0;
  const remain = tokensLeft + Math.max(0, quota - used);
  if (remain <= 0) return new Response(JSON.stringify({ error: "PAYWALL" }), { status: 402, headers });

  // Generate
  if (forMock) {
    const mock = [
      "Det var en gång en snäll liten drake som hette Disa. En solig morgon hörde hon ett försiktigt 'hej' från busken…",
      "I en skog där träden vinkade med sina grenar bodde en kanin som alltid sa 'tjoho' när solen gick upp…",
      "På en ö av mjuka kuddar landade en pappersballong. Ut hoppade en modig ekorre och tittade nyfiket runt…"
    ];
    const pick = mock[Math.floor(Math.random()*mock.length)];
    const memTail = memory?.hero ? ` Idag skulle ${memory.hero} gärna visa vad mod och vänskap betyder.` : "";
    const story = `${pick}${memTail}\n\nSnart löste de ett litet mysterium tillsammans.\n\nOch så somnade alla med ett leende.`;
    await decrementUsage(ent, entKV, user.id, usageKV, ym, used);
    return new Response(JSON.stringify({ story }), { status: 200, headers });
  }

  const sys = kidsSystemPrompt(memory);
  try {
    const apiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.9,
        max_tokens: 900,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `Barnets tema: ${prompt}` }
        ]
      })
    });
    if (!apiRes.ok) {
      const t = await apiRes.text().catch(()=>"(no text)");
      return new Response(JSON.stringify({ error: "UPSTREAM", detail: t }), { status: 502, headers });
    }
    const data = await apiRes.json();
    let story = data?.choices?.[0]?.message?.content?.trim() || "";
    story = sanitizeOutput(story) || "Ingen saga skapades.";

    await decrementUsage(ent, entKV, user.id, usageKV, ym, used);
    return new Response(JSON.stringify({ story }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: "SERVER_AI", detail: String(err||"") }), { status: 500, headers });
  }
}

async function decrementUsage(ent, entKV, userId, usageKV, ym, used){
  if (ent.tokens_left && ent.tokens_left > 0){
    ent.tokens_left -= 1;
    await entKV.put(`ent:${userId}`, JSON.stringify(ent));
    return;
  }
  await usageKV.put(`m:${userId}:${ym}`, String(used+1));
}
