// Simple story generator helper to enforce different lengths per age category.
//
// Usage:
//   const { buildPromptForAge } = require('./functions/generateStory');
//   const prompt = buildPromptForAge(2, "en räv och en skog");
//   // send prompt to your model / generation pipeline
//
// The function returns { category, minWords, maxWords, targetWords, prompt }
// so you can both log the values and feed prompt to your generator.

function getCategoryForAge(age) {
  // accept either number or string convertible to number
  const a = Number(age);
  if (Number.isNaN(a)) throw new Error('age must be a number');
  if (a <= 2) return '1-2';
  if (a <= 4) return '3-4';
  if (a <= 7) return '5-7';
  if (a <= 10) return '8-10';
  return '11-12';
}

const AGE_LENGTH_MAP = {
  // these are word counts (min, max)
  '1-2': { min: 40,  max: 120 },   // very short, simple sentences
  '3-4': { min: 120, max: 260 },
  '5-7': { min: 260, max: 450 },
  '8-10': { min: 450, max: 700 },
  '11-12': { min: 800, max: 1200 } // longer chapter‑like story
};

function pickTargetWords(min, max) {
  // choose a reasonable target in the interval
  return Math.floor(min + Math.random() * (max - min + 1));
}

function buildPromptForAge(age, topicOrBrief) {
  const category = getCategoryForAge(age);
  const { min, max } = AGE_LENGTH_MAP[category];
  const targetWords = pickTargetWords(min, max);

  // A clear instruction that helps the model hit the target length
  const prompt = [
    `Skriv en barnberättelse för ålderskategorin ${category} (age ${age}).`,
    `Ämne / kort brief: ${topicOrBrief || 'Valfri barnberättelse med vänligt språk'}.`,
    `Berättelsen ska vara enkel att förstå och passa för ${category}.`,
    `Målsättning: skriv ungefär ${targetWords} ord (ange antal ord i din interna kalkyl).`,
    `Använd korta meningar för yngre barn (1-4), något mer beskrivande språk för äldre.`,
    `Avsluta med en kort moral / lärdom om det passar berättelsen.`,
    `Skriv endast själva berättelsen i svaret — inga förklaringar eller metakommentarer.`
  ].join(' ');

  return {
    category,
    minWords: min,
    maxWords: max,
    targetWords,
    prompt
  };
}

// Helper: naive word count
function countWords(text) {
  if (!text) return 0;
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

// Helper: trim text by words to targetWords (keeps sentence boundaries naive)
function trimToTargetWords(text, targetWords) {
  const words = String(text).trim().split(/\s+/);
  if (words.length <= targetWords) return text;
  // Try to cut at the last full sentence before target if possible
  const snippet = words.slice(0, targetWords).join(' ');
  // If last character is not punctuation, try to trim to last sentence-ending punctuation
  const idx = Math.max(snippet.lastIndexOf('.'), snippet.lastIndexOf('!'), snippet.lastIndexOf('?'));
  if (idx > -1 && idx > snippet.length * 0.4) {
    return snippet.slice(0, idx + 1).trim();
  }
  return snippet.trim() + '…';
}

module.exports = {
  buildPromptForAge,
  getCategoryForAge,
  countWords,
  trimToTargetWords
};
