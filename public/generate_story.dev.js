// public/generate_story.dev.js
// === DEV v1.0 — kopplar world_state till backend-generering ===

import { getWorldState, setWorldState, summarizeWorldState } from "./worldstate.gc.js";

console.log("generate_story.dev.js: loaded");

export async function generateStory(userPrompt) {
  const ws = getWorldState();
  const body = {
    prompt: userPrompt,
    world_state: getWorldState(),
    world_summary: summarizeWorldState(ws)
  };

  const res = await fetch("/api/generate_story", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(`Serverfel: ${res.status}`);
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(json.error || "Kunde inte generera berättelse");

  const story = json.data?.story_text || "";
  const next = json.data?.world_state_next;
  if (next && typeof next === "object") {
    setWorldState(next); // uppdatera världen för nästa kapitel
  }
  return story;
}
