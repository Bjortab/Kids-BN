// functions/api/illustrate_variations.js
// -----------------------------------------------------
// Kids-BN neutral version (bildgenerering avstängd)
//
// Den här versionen ligger kvar utan att orsaka build-fel.
// När du senare vill aktivera bildgenerering igen (OpenAI DALL-E),
// ersätt bara denna fil med den riktiga versionen.
// -----------------------------------------------------

export const onRequestOptions = async ({ env }) => {
  const origin = env?.BN_ALLOWED_ORIGIN || "*";
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
};

export const onRequestGet = async ({ env }) => {
  const origin = env?.BN_ALLOWED_ORIGIN || "*";
  return new Response(
    JSON.stringify({
      ok: true,
      message: "Bildgenerering (illustrate_variations) är inaktiv i Kids-BN.",
      hint: "Aktiveras när du vill lägga till AI-bilder till sagor igen.",
    }),
    {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Content-Type": "application/json; charset=utf-8",
      },
    }
  );
};

// Om någon försöker POST:a till endpointen
export const onRequestPost = async ({ env }) => {
  const origin = env?.BN_ALLOWED_ORIGIN || "*";
  return new Response(
    JSON.stringify({
      ok: false,
      error: "Bildgenerering är avstängd i den här versionen.",
    }),
    {
      status: 405,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Content-Type": "application/json; charset=utf-8",
      },
    }
  );
};
