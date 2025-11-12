// functions/api/generate_story.js  — DUMMY TEST
export async function onRequest(context) {
  const { request } = context;
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return new Response(JSON.stringify({ ok:false, error:'Method not allowed' }), { status:405, headers:{...CORS,'Content-Type':'application/json'} });

  // svara direkt med JSON (ingen modell alls)
  return new Response(JSON.stringify({
    ok: true,
    data: {
      story_text: 'TEST: generate_story-rutten körs (ingen modell kallad).',
      world_state_next: { recap: 'Dummy-kapitel' }
    }
  }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control':'no-store' } });
}
