export async function onRequestPost({ env }) {
  try {
    const kv = env.kidsbn_profiles;
    await kv.list().then(async (res) => {
      for (const key of res.keys) await kv.delete(key.name);
    });
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
