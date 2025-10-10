import { ok, bad, methodNotAllowed, ensurePost } from '../_utils';

export const onRequestPost = async (ctx) => {
  try{
    const { request, env } = ctx;
    if (!ensurePost(request)) return methodNotAllowed();

    const body = await request.json();
    const {
      childName = '',
      heroName = '',
      ageRange = '3-4',
      prompt = '',
      controls = { minWords:250, maxWords:500, tone:'barnvänlig', chapters:1 },
      read_aloud = true
    } = body || {};

    // Bygg “system prompt”
    const sys = [
      `Du är en varm barnboksförfattare på svenska.`,
      `Skriv en saga för åldersspann ${ageRange}.`,
      `Längd: mellan ${controls.minWords} och ${controls.maxWords} ord.`,
      `Ton och stil: ${controls.tone}.`,
      `Kapitel: ${controls.chapters} (endast om naturligt).`,
      `Använd hjältenamnet endast om det skickats in av användaren.`,
      `Undvik att blanda in hjältar från tidigare sagor om de inte anges nu.`,
    ].join(' ');

    const user = [
      `Barnets namn: ${childName || '(inte angivet)'}`,
      heroName ? `Hjältens namn: ${heroName}` : '',
      `Sagognista: ${prompt}`
    ].filter(Boolean).join('\n');

    // ===== OpenAI text =====
    const textRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type':'application/json'
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.7,
        messages: [
          { role:'system', content: sys },
          { role:'user', content: user }
        ]
      })
    });

    if (!textRes.ok){
      const t = await textRes.text().catch(()=> '');
      return bad(`OpenAI text fel: ${textRes.status} ${t}`, 502);
    }
    const textData = await textRes.json();
    const story = textData.choices?.[0]?.message?.content?.trim?.() || '';

    let audioUrl = null;

    if (read_aloud && story){
      // ===== ElevenLabs TTS (valfritt om du inte vill läsa upp direkt) =====
      try{
        const voiceId = env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'; // standard-röst
        const tts = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method:'POST',
          headers:{
            'xi-api-key': env.ELEVENLABS_API_KEY,
            'Content-Type':'application/json'
          },
          body: JSON.stringify({ text: story, voice_settings:{ stability:0.5, similarity_boost:0.75 } })
        });

        if (tts.ok){
          const buf = await tts.arrayBuffer();
          // Spara i R2 eller returnera som data-URL (enkelt men större svar).
          // Här returnerar vi tillfälligt en data-URL för demo:
          const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
          audioUrl = `data:audio/mpeg;base64,${base64}`;
        }
      }catch(_e){}
    }

    return ok({ story, audioUrl });
  }catch(err){
    return bad(`Serverfel: ${err?.message || err}`, 500);
  }
};

// GET -> 405 för att undvika 405-förvirring i UI om fel metod skickas
export const onRequestGet = async () => methodNotAllowed();
