export function corsHeaders(env, forMock=false) {
  const allowed = env?.KIDSBN_ALLOWED_ORIGIN;
  const origin = allowed || (forMock ? "*" : "");
  const base = {
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Stripe-Signature",
    "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
  };
  if (origin) return { ...base, "Access-Control-Allow-Origin": origin };
  return base;
}

const BAD_WORDS = [
  "sex","porn","våldtäkt","erot","nak","snusk","whore","penis","vagina","bröst",
  "kill yourself","suicide","self-harm","terror","bomba","drog","knark","alkohol",
  "rasist","hat","jävla","helvete","kuk","fitta","hora"
];
const BAD_THEMES = [
  /vux(et|na)?/i, /dejta/i, /kys(s|sa)/i, /alkohol/i, /droger?/i, /våld/i, /skräck/i
];

export function isBlockedPrompt(s) {
  if(!s) return true;
  const text = String(s).toLowerCase();
  if (BAD_WORDS.some(w => text.includes(w))) return true;
  if (BAD_THEMES.some(re => re.test(text))) return true;
  return false;
}

export function sanitizeOutput(story) {
  if(!story) return "";
  let out = String(story);
  for (const w of BAD_WORDS) {
    const re = new RegExp(w, "gi");
    out = out.replace(re, "🌟");
  }
  return out;
}

export function kidsSystemPrompt(memory) {
  const lines = [];
  lines.push(`Du är en barnvänlig sagoberättare på svenska.`);
  lines.push(`Regler:`);
  lines.push(`- Varm, trygg ton. Ungefär 6–10 år.`);
  lines.push(`- Inget våld, skräck, svordomar eller vuxet innehåll.`);
  lines.push(`- Max 450–600 ord, tydlig början, mitten, slut och liten lärdom.`);
  lines.push(`- Vänliga ljudord (”plopp”, ”tjoho”) ibland, sparsamt.`);
  lines.push(`- Snälla, neutrala namn. Ingen insamling av persondata.`);
  lines.push(`- Om temat är olämpligt: avböj vänligt och föreslå snällare alternativ.`);
  lines.push(`- Avsluta med en mysig slutrad, t.ex. ”Och så somnade alla med ett leende.”.`);
  const hero = (memory?.hero || "").trim();
  const facts = Array.isArray(memory?.facts) ? memory.facts.filter(Boolean).slice(0,3) : [];
  if (hero || facts.length){
    lines.push(`---`);
    lines.push(`Återkommande hjälte (om relevant): ${hero || "ingen"}.`);
    if (facts.length) lines.push(`Fakta om hjälten: ${facts.join("; ")}.`);
    lines.push(`Om användaren byter tema helt, inkludera hjälten bara om det känns naturligt och snällt.`);
  }
  return lines.join("\n");
}
