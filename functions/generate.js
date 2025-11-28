// TEST-STUB för /api/generate
// Den här är bara till för att bevisa att vi träffar rätt fil.

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

export async function onRequestPost() {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "TEST_STUB_FROM_GENERATE_JS"
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    }
  );
}
