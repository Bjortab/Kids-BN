// === DEV v1.0 — Frontend Story Engine (DEV) ===

import { getWorldState, summarizeWorldState } from "./worldstate.dev.js";

const API_BASE = "/api";

export async function continueChapter({ bookId, lastChapterTextOrSummary, endingStyle, targetWords }) {
  const ws = getWorldState();
  const payload = {
    book_id: bookId,
    last_chapter_text_or_summary: lastChapterTextOrSummary || summarizeWorldState(ws),
    world_state: ws,
    ending_style: endingStyle || "open_hook",
    target_words: targetWords || 450
  };
  console.log("🧪 engine.continue payload ->", payload);

  const res = await fetch(`${API_BASE}/story/continue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  console.log("🧪 engine.continue <-", json);
  if (!json.ok) throw new Error(json.error || "Okänt fel");
  return json.data;
}
