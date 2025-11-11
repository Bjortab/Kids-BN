// === DEV VERSION v1.0 — BN-Kids / BN-Future Story Generator ===
// Den här filen körs i webbläsaren. Den skickar prompt + world_state till backend.
// När allt fungerar: kopiera till generate_story.gc.js och bumpa versionen.

import { getWorldState, summarizeWorldState } from "./worldstate.dev.js";

console.log("🧪 generate_story.dev.js laddad");

export async function generateStory(prompt) {
  try {
    console.log("🧪 Skickar prompt + world_state till backend...");

    // 1. Hämta aktuell world_state från localStorage (plats, karaktärer, mm)
    const ws = getWorldState();
    const summary = summarizeWorldState(ws);

    // 2. Förbered data att skicka till backend
    const body = {
      prompt,           // t.ex. "Fido flög till månen"
      world_state: ws,  // hela objektet
      world_summary: summary
    };

    // 3. Anropa backend (Worker)
    const res = await fetch("/api/generate_story", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error(`Serverfel: ${res.status}`);
    const json = await res.json();
    console.log("🧪 Svar från backend:", json);

    // 4. Hantera svar
    if (!json.ok) throw new Error(json.error || "Kunde inte generera berättelse");

    const storyText = json.data?.story_text || "(Inget svar från modellen)";
    console.log("🧪 Ny berättelse:", storyText);

    return storyText;

  } catch (err) {
    console.error("❌ Fel i generateStory:", err);
    return `Fel: ${err.message}`;
  }
}
