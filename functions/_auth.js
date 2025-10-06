export async function getUser(context){
  const { request, env } = context;
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if(!m) return null;
  const accessToken = m[1];
  try{
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "apikey": env.SUPABASE_SERVICE_ROLE
      }
    });
    if(!res.ok) return null;
    const user = await res.json();
    return { id: user.id, email: user.email };
  }catch{ return null; }
}
