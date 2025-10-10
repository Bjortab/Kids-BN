// /api/generate_story  —  MÅSTE svara på POST (annars 405)

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}

export async function onRequestOptions() {
  // Preflight
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost({ request, env }) {
  try {
    const { name, ageRange, prompt, heroName, minWords, maxWords, ageTone } = await request.json();

    if (!name || !prompt || !ageRange) {
      return Response.json(
        { ok: false, error: "name, prompt och ageRange krävs", status: 400 },
        { status: 400, headers: corsHeaders() }
      );
    }

    // --- Här skulle din OpenAI-anrop gå. För att undvika 405 fokuserar vi på korrekt svarformat. ---
    // Validera att OPENAI_API_KEY finns – annars svara tydligt men korrekt.
    if (!env.OPENAI_API_KEY) {
      return Response.json(
        { ok: false, error: "OPENAI_API_KEY saknas i miljön", status: 501 },
        { status: 501, headers: corsHeaders() }
      );
    }

    // Minimal prompt/”mock” om du vill testa flödet utan att dra API:
    const ord = Math.max(minWords || 120, 120);
    const story = `(${ageRange}, ${ageTone || "barnvänlig ton"}) ${name} – ${heroName ? "med hjälten " + heroName + " – " : ""}${prompt}. [≈${ord} ord, demo-berättelse]`;

    return Response.json({ ok: true, story }, { headers: corsHeaders() });
  } catch (err) {
    return Response.json(
      { ok: false, error: `Serverfel: ${err.message}`, status: 500 },
      { status: 500, headers: corsHeaders() }
    );
  }
}
