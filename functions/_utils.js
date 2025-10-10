export const ok = (data, init={}) =>
  new Response(JSON.stringify(data), {
    headers: { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' },
    ...init
  });

export const bad = (msg, code=400) =>
  ok({ error: msg }, { status: code });

export const methodNotAllowed = () =>
  bad('Method Not Allowed', 405);

export const ensurePost = (request) => request.method === 'POST';
