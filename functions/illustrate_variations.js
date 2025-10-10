import { ok, bad, methodNotAllowed, ensurePost } from '../_utils';

export const onRequestPost = async (ctx) => {
  try{
    const { request, env } = ctx;
    if (!ensurePost(request)) return methodNotAllowed();

    const buf = await request.arrayBuffer();
    if (!buf || buf.byteLength < 4000) return bad('Tom eller för kort ljudfil.', 400);

    // OpenAI Whisper v2
    const form = new FormData();
    form.append('file', new Blob([buf], { type:'audio/webm' }), 'speech.webm');
    form.append('model', env.WHISPER_MODEL || 'whisper-1'); // använd env för flexibilitet
    form.append('language', 'sv');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method:'POST',
      headers:{ 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
      body: form
    });

    if (!res.ok){
      const t = await res.text().catch(()=> '');
      return bad(`Whisper fel: ${res.status} ${t}`, 502);
    }

    const data = await res.json();
    const text = (data.text || '').trim();
    return ok({ text });
  }catch(err){
    return bad(`Serverfel (whisper): ${err?.message || err}`, 500);
  }
};

export const onRequestGet = async () => methodNotAllowed();
