export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  const allow = env.KIDSBN_ALLOWED_ORIGIN || origin;

  const bad = (c,m)=>new Response(m,{status:c,headers:{
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'Content-Type'
  }});

  try{
    const { prompt, count=4 } = await request.json();
    if (!env.OPENAI_API_KEY) return bad(500,'OPENAI_API_KEY saknas');

    const ai = await fetch('https://api.openai.com/v1/images/edits', { method:'OPTIONS' }); // keep warm (no-op)

    const res = await fetch('https://api.openai.com/v1/images/generations',{
      method:'POST',
      headers:{'Authorization':`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
      body: JSON.stringify({ model:'gpt-image-1', prompt, n: count, size:'1024x1024' })
    });
    if (!res.ok) return bad(500, await res.text());
    const data = await res.json();

    const urls = [];
    let idx = 0;
    for (const img of data.data){
      const base64 = img.b64_json;
      const bin = Uint8Array.from(atob(base64), c=>c.charCodeAt(0));
      const id = `img_${Date.now()}_${idx++}.png`;
      const key = `${env.ART_PREFIX || 'kids/art'}/${id}`;
      await env.BN_ART_BUCKET.put(key, bin, {
        httpMetadata:{contentType:'image/png', cacheControl:'public,max-age=31536000,immutable'}
      });
      // offentliga R2-länkar via /art?id=
      urls.push(`/art?id=${encodeURIComponent(id)}`);
    }

    return new Response(JSON.stringify({ images: urls }), {
      headers:{'Content-Type':'application/json','Access-Control-Allow-Origin': allow,'Access-Control-Allow-Headers':'Content-Type'}
    });
  }catch(err){
    return bad(500, `illustrate error: ${err.message}`);
  }
}

export async function onRequestOptions({ request, env }) {
  const origin = request.headers.get('Origin') || '*';
  return new Response(null, { headers:{
    'Access-Control-Allow-Origin': env.KIDSBN_ALLOWED_ORIGIN || origin,
    'Access-Control-Allow-Headers':'Content-Type',
    'Access-Control-Allow-Methods':'POST,OPTIONS'
  }});
}
