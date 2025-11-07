// VERSION: 1.1.0
// BUILD: 2025-11-07
// Handler example: Node.js + Express style. Uses storyTemplates.js above.
// Replace OpenAI call code with your project's client (openai sdk or fetch).
//
// ENV needed:
// - OPENAI_API_KEY
// - (optional) TTS service credentials, R2 config for storing chunks

const { TEMPLATES } = require('./storyTemplates');
const fetch = require('node-fetch'); // or your http client
// const OpenAI = require('openai'); // uncomment if using official sdk

// Utility: estimate tokens from words (rough)
function estimateTokensFromWords(words) {
  return Math.ceil(words * 1.6);
}

// Pick template helper
function pickTemplate(ageRange) {
  // sanitize input, map near values
  if (!ageRange) return TEMPLATES['7-10'];
  const key = String(ageRange).trim();
  if (TEMPLATES[key]) return TEMPLATES[key];
  // map broad ranges like "1-2", "3-6", "7-10"
  if (key === '1-2' || key === '1' || key === '2') {
    // user asked to split; default to '2' if ambiguous
    return TEMPLATES[key === '1' ? '1' : (key === '2' ? '2' : '2')];
  }
  if (key === '3-6') return TEMPLATES['3-6'];
  if (key === '7-10') return TEMPLATES['7-10'];
  if (key === '9-10') return TEMPLATES['9-10'];
  if (key === '11-12' || key === '11') return TEMPLATES['11-12'];
  // fallback
  return TEMPLATES['7-10'];
}

// Split text by sentence boundaries into approximate chunks of targetWords
function splitIntoChunksByWords(text, targetWords = 200) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= targetWords) return [text.trim()];
  const chunks = [];
  let i = 0;
  while (i < words.length) {
    const slice = words.slice(i, i + targetWords);
    chunks.push(slice.join(' '));
    i += targetWords;
  }
  return chunks;
}

// Example handler (Express)
async function generateStoryHandler(req, res) {
  try {
    const { ageRange = '7-10', heroName = '', prompt: userPrompt = '' } = req.body || {};
    const tpl = pickTemplate(ageRange);

    // Build full prompt
    let fullPrompt = tpl.prompt;
    // Replace placeholders if template has placeholders (this version uses simple append)
    if (userPrompt) {
      fullPrompt += `\n\nExtra info: ${userPrompt.trim()}`;
    }
    if (heroName) {
      fullPrompt += `\n\nMain character name: ${heroName.trim()}`;
    }

    // Word targets for token calculation
    const maxWords = tpl.words[1];
    const maxTokens = estimateTokensFromWords(maxWords) + 50;

    // CALL MODEL (placeholder)
    // Replace this block with your OpenAI client call (ChatCompletion or createCompletion)
    // Example using fetch to OpenAI chat completions (pseudo):
    const openAIKey = process.env.OPENAI_API_KEY;
    if (!openAIKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'; // change as needed
    const body = {
      model,
      messages: [
        { role: 'system', content: 'You are a helpful creative story writer for children in Swedish.' },
        { role: 'user', content: fullPrompt }
      ],
      max_tokens: maxTokens,
      temperature: 0.6,
      stop: null
    };

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const txt = await r.text().catch(()=>'(no body)');
      return res.status(502).json({ error: 'OpenAI error', status: r.status, body: txt });
    }
    const jr = await r.json();
    // The exact path depends on model/response shape; try to extract text safely:
    const content = (jr.choices && jr.choices[0] && jr.choices[0].message && jr.choices[0].message.content) || jr.choices?.[0]?.text || '';
    const storyText = content.trim();

    // Attempt to split off image prompts if they are appended as Image1: lines.
    const lines = storyText.split('\n').map(l => l.trim());
    const imagePrompts = [];
    const storyLines = [];
    for (const line of lines) {
      if (/^Image\d*:/i.test(line)) {
        imagePrompts.push(line.replace(/^Image\d*:\s*/i, '').trim());
      } else {
        storyLines.push(line);
      }
    }
    const story = storyLines.join('\n').trim();

    // Optional: chunk story for TTS if long
    const totalWords = story.split(/\s+/).filter(Boolean).length;
    let chunks = [story];
    if (totalWords > 400) {
      // target chunk size ~200-300 words
      chunks = splitIntoChunksByWords(story, 260);
    }

    // Respond with story, image prompts and chunk info
    return res.json({
      ageRange,
      wordsEstimate: totalWords,
      chunksCount: chunks.length,
      chunksWords: chunks.map(c => c.split(/\s+/).filter(Boolean).length),
      story,
      imagePrompts
    });
  } catch (err) {
    console.error('generateStoryHandler error', err);
    return res.status(500).json({ error: 'server error', message: String(err) });
  }
}

module.exports = {
  generateStoryHandler,
  pickTemplate,
  splitIntoChunksByWords
};
