// functions/api/images.js — locked
// Binding: BN_IMAGES (R2 bucket "bn-images")
// Läs manifest: images/catalog.json
// POST { storyText, ageRange, count? } -> { ok:true, images:[{id,url,...}, ...] }

const SWEDISH_STOP = new Set([
  "och","det","att","som","en","i","på","för","med","av","är","till","den",
  "de","om","har","hade","var","så","men","vi","ni","du","han","hon","ett",
  "från","under","över","då","när","eller","utan","sin","sitt","sina","bara"
]);

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(w => w && !SWEDISH_STOP.has(w) && w.length > 2);
}

function scoreImage(img, tokens, ageRange) {
  const tagSet = new Set((img.tags || []).map(t => t.toLowerCase()));
  let score = 0;
  for (const t of tokens) if (tagSet.has(t)) score += 1;
  if ((img.ageRanges || []).includes(ageRange)) score += 1.2;
  return score;
}

export const onRequestPost = async ({ env, request }) => {
  try {
    if (!env?.BN_IMAGES) {
      return new Response(JSON.stringify({ ok:false, error:"BN_IMAGES binding saknas" }), {
        status: 500, headers:{ "Content-Type":"application/json" }
      });
    }
    const { storyText, ageRange, count = 3 } = await request.json();
    if (!storyText) {
      return new Response(JSON.stringify({ ok:false, error:"storyText saknas" }), {
        status: 400, headers:{ "Content-Type":"application/json" }
      });
    }

    const obj = await env.BN_IMAGES.get("images/catalog.json");
    if (!obj) {
      return new Response(JSON.stringify({ ok:false, error:"catalog.json saknas i R2 (bn-images)" }), {
        status: 500, headers:{ "Content-Type":"application/json" }
      });
    }
    const manifest = await obj.json();
    const images = manifest?.images || [];
    if (!images.length) {
      return new Response(JSON.stringify({ ok:true, images:[] }), {
        status: 200, headers:{ "Content-Type":"application/json" }
      });
    }

    const tokens = tokenize(storyText);
    const ranked = images
      .map(img => ({ img, score: scoreImage(img, tokens, ageRange) }))
      .sort((a,b) => b.score - a.score);

    let picks;
    if (!ranked.length || ranked[0].score === 0) {
      const pool = images.filter(i => (i.ageRanges || []).includes(ageRange));
      const src = pool.length ? pool : images;
      picks = [...src].sort(() => Math.random() - 0.5).slice(0, Math.max(3, count));
    } else {
      picks = ranked.slice(0, 6).map(r => r.img).sort(()=>Math.random()-0.5).slice(0, Math.max(3, count));
    }

    return new Response(JSON.stringify({ ok:true, images: picks }), {
      status: 200, headers:{ "Content-Type":"application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error:String(e?.message || e) }), {
      status: 500, headers:{ "Content-Type":"application/json" }
    });
  }
};
