export async function onRequest({ env }) {
  const hasOpenAI = !!env.OPENAI_API_KEY;
  const hasAnthropic = !!env.ANTHROPIC_API_KEY;

  // Välj provider enligt explicita variabler
  let provider = env.PROVIDER || "";
  if (!provider) {
    // fallback: gissa på modellnamn om PROVIDER saknas
    if ((env.MODEL_CLAUDE || "").startsWith("claude")) provider = "anthropic";
    else if ((env.MODEL_TEXT || "").startsWith("gpt")) provider = "openai";
  }

  const model =
    provider === "anthropic" ? env.MODEL_CLAUDE :
    provider === "openai" ? env.MODEL_TEXT :
    (env.MODEL_TEXT || env.MODEL_CLAUDE || "");

  return new Response(JSON.stringify({
    ok: true,
    provider,
    model,
    keys: {
      OPENAI_API_KEY: hasOpenAI ? "present" : "missing",
      ANTHROPIC_API_KEY: hasAnthropic ? "present" : "missing"
    },
    vars: {
      LANG_DEFAULT: env.LANG_DEFAULT || "(missing)"
    }
  }, null, 2), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
