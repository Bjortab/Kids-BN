// functions/_shared/text_utils.js

export function normalizeText(s) {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/[.,;:!?()"\-]/g, "") // ta bort enklare skiljetecken
    .replace(/\s+/g, " ")
    .trim();
}

// Levenshtein (tillräckligt snabb för meningar)
export function levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const v0 = new Array(bl + 1);
  const v1 = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) v0[j] = j;
  for (let i = 0; i < al; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < bl; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= bl; j++) v0[j] = v1[j];
  }
  return v1[bl];
}

export function similarity(a, b) {
  if (!a || !b) return 0;
  const d = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length) || 1;
  return (maxLen - d) / maxLen; // 1.0 = identisk
}

export function makeCacheKey(normText, voiceId, model, lang) {
  const safe = encodeURIComponent(normText).slice(0, 200);
  return `tts/${lang}/${model}/${voiceId}/${safe}.mp3`;
}
