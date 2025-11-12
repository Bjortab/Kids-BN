// public/app_ws.dev.js  — GC v1.0 (frikopplad dev-knapp)
import { getWorldState, summarizeWorldState, autoUpdateRecapFromText } from './worldstate.gc.js';

// Hämta element — anpassa selectors om dina id/attribut skiljer sig
const btn = document.getElementById('btn-create-ws');        // ny knapp
const out = document.querySelector('#story-text') || document.querySelector('[data-id="story"]');
const err = document.querySelector('#error')      || document.querySelector('[data-id="error"]');
const input = document.querySelector('#story-input') || document.querySelector('[name="prompt"]');

async function postJSON(url, payload) {
  const res  = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  const ct   = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('text/html') || text.startsWith('<!doctype')) {
    throw new Error(`Fick HTML från ${url} (status ${res.status}).`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0,160)}`);
  try { return JSON.parse(text); } catch { throw new Error('Svar var inte JSON.'); }
}

async function createStoryWithWorld() {
  if (!input) return;
  const userPrompt = (input.value || '').toString();

  const ws = getWorldState();
  const summary = summarizeWorldState(ws);

  // ⚠️ Vi rör inte backend – vi skickar bara en tydlig kontext före din prompt
  const finalPrompt = `${summary}

Skriv nästa kapitel. Håll strikt kausalitet (inga hopp i tid/plats utan övergång),
behåll namn/platser/mål, inga “moralslut” – avsluta konkret i scenen.

Användarens önskemål:
${userPrompt}`;

  try {
    if (btn) btn.disabled = true;
    err && (err.textContent = '');

    // Anropa din redan fungerande endpoint oförändrat:
    const json = await postJSON('/api/generate_story', { prompt: finalPrompt });

    const story = json?.data?.story_text || json?.story || json?.text || '';
    if (!story) throw new Error('Servern returnerade ingen story_text.');

    out && (out.textContent = story);
    // uppdatera recap enkelt (frivilligt, men ger bättre fortsättning)
    autoUpdateRecapFromText(story);

  } catch (e) {
    console.error('[WS] error', e);
    err && (err.textContent = `WS-fel: ${e.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// koppla knapp om den finns
btn && btn.addEventListener('click', createStoryWithWorld);
