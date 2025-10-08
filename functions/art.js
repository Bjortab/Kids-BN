export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return new Response('missing id', { status: 400 });
  const key = `${env.ART_PREFIX || 'kids/art'}/${id}`;
  const obj = await env.BN_ART_BUCKET.get(key);
  if (!obj) return new Response('not found', { status: 404 });
  return new Response(obj.body, {
    headers: { 'Content-Type':'image/png', 'Cache-Control':'public,max-age=31536000,immutable' }
  });
}
