// === GOLDEN COPY v1.0 — Frontend Story Engine (GC) ===
// Samlar world_state + användarval och kallar backend /api/story/continue

import { getWorldState, summarizeWorldState } from "./worldstate.gc.js";

const API_BASE = "/api"; // justera om dina routes skiljer sig

export async function continueChapter({ bookId, lastChapterTextOrSummary, endingStyle, targetWords }) {
  const ws = getWorldState();
  const payload = {
    book_id: bookId,
    last_chapter_text_or_summary: lastChapterTextOrSummary || summarizeWorldState(ws),
    world_state: ws,
    ending_style: endingStyle || "open_hook",
    target_words: targetWords || 450
  };

  try {
    const res = await fetch(`${API_BASE}/story/continue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Okänt fel");
    return json.data; // { next_chapter_text, updated_summary? }
  } catch (err) {
    throw new Error(`Fel vid fortsättning: ${err.message}`);
  }
}
