 url=https://github.com/Bjortab/bn-demo/blob/8d8061d769669070a6526fac75feab212da70612/web/app.js
// web/app.js
// GC v2.0 – frontend-kontroller
// Viktigt: ändra API_BASE till din worker-URL.
const API_BASE = "https://bn-worker.bjorta-bb.workers.dev"; // <- BYT vid behov

const $ = (id) => document.getElementById(id);
const log = (m) => {
  const t = new Date().toLocaleTimeString();
  const line = `[${t}] ${m}\n`;
  const el = $("log");
  el.textContent += line;
  el.scrollTop = el.scrollHeight;
};

// enkel rullande ... spinner
let spinTimer = null;
function startSpin() {
  stopSpin();
  const s = $("spin");
  let dots = 0;
  spinTimer = setInterval(() => {
    dots = (dots + 1) % 4;
    s.textContent = ".".repeat(dots);
  }, 300);
}
function stopSpin() {
  const s = $("spin");
  if (spinTimer) clearInterval(spinTimer);
  s.textContent = "";
}

async function statusPing() {
  try {
    log("Kollar status…");
    const r = await fetch(`${API_BASE}/api/v1/status`, { method: "GET" });
    const j = await r.json();
    log(`STATUS: ${JSON.stringify(j)}`);
  } catch (e) {
    log(`Status-fel: ${e.message || e}`);
    alert("Failed to fetch. Se loggen för detaljer.");
  }
}

async function generate() {
  const btn = $("go");
  const storyBox = $("story");
  const player = $("player");

  try {
    const prompt = $("prompt").value.trim();
    const lvl = parseInt($("level").value, 10) || 3;
    const mins = parseInt($("minutes").value, 10) || 5;
    const lang = $("lang").value || "sv";
    const variant = $("variant").checked;

    if (!prompt) {
      alert("Skriv en prompt.");
      return;
    }

    btn.disabled = true;
    $("goText").textContent = "Genererar…";
    startSpin();
    storyBox.textContent = ""; // clear text

    const body = { lvl, mins, lang, prompt };
    // “Variant” ger ett seed så samma prompt kan bli annorlunda
    if (variant) body.seed = Date.now();

    log(`POST /episodes/generate (lvl=${lvl}, min=${mins}, lang=${lang}${variant ? ", variant" : ""})`);

    const r = await fetch(`${API_BASE}/episodes/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    log(`HTTP: ${r.status} ${r.statusText}`);
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`Generate ${r.status}: ${text.slice(0, 240)}`);
    }

    const data = await r.json();
    // { ok, cached, text, audio: { format, base64 }, r2Key? }
    if (data.text) {
      storyBox.textContent = data.text;
      log(`TEXT len=${data.text.length}${data.cached ? " (cache)" : " (new)"}`);
    } else {
      log("Ingen text mottagen.");
    }

    if (data.audio && data.audio.base64 && data.audio.format) {
      const src = `data:audio/${data.audio.format};base64,${data.audio.base64}`;
      player.src = src;
      try { await player.play(); } catch { /* ignore */ }
      log(`Audio: inline base64 ${data.cached ? "(cache)" : "(new)"}`);
    } else {
      log("Inget audio mottaget.");
    }
  } catch (e) {
    log(`Fel: ${e.message || e}`);
    alert("Failed to fetch. Se loggen för detaljer.");
  } finally {
    stopSpin();
    $("goText").textContent = "Generera & lyssna";
    btn.disabled = false;
  }
}

/* ---------------- Kapitelbok klientfunktioner ---------------- */
const AUTOSAVE_INTERVAL_MS = 10000;
let chapterAutosaveTimer = null;
let currentStoryId = localStorage.getItem('bn_current_story') || null;
let currentChapterIndex = null;

function initChapterModule() {
  const btnSave = document.getElementById('btnSave');
  const btnContinue = document.getElementById('btnContinue');
  const btnList = document.getElementById('btnList');
  btnSave?.addEventListener('click', saveChapter);
  btnContinue?.addEventListener('click', generateContinuation);
  btnList?.addEventListener('click', listChapters);

  // voice buttons (Web Speech API)
  if (window.speechSynthesis) {
    document.getElementById('btnSpeak')?.addEventListener('click', () => {
      const text = document.getElementById('chapterText').value || '';
      if (!text) return alert('Ingen text att spela upp.');
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = 'sv-SE';
      speechSynthesis.cancel();
      speechSynthesis.speak(utt);
    });
  } else {
    document.getElementById('btnSpeak')?.disabled = true;
  }

  setupSpeechRecognition();

  // autosave
  chapterAutosaveTimer = setInterval(() => {
    const title = document.getElementById('bkTitle').value.trim();
    const text = document.getElementById('chapterText').value;
    if (!text) return;
    if (!currentStoryId) {
      currentStoryId = crypto.randomUUID();
      localStorage.setItem('bn_current_story', currentStoryId);
    }
    const idx = currentChapterIndex || 1;
    localStorage.setItem(`bn_autosave_${currentStoryId}_ch${idx}`, JSON.stringify({ title, text, saved_at: new Date().toISOString() }));
    setChapterStatus('Autosparat lokalt');
  }, AUTOSAVE_INTERVAL_MS);

  // restore potential autosave
  if (currentStoryId) {
    const raw = localStorage.getItem(`bn_autosave_${currentStoryId}_ch1`);
    if (raw) {
      try {
        const o = JSON.parse(raw);
        document.getElementById('bkTitle').value = o.title || '';
        document.getElementById('chapterText').value = o.text || '';
        setChapterStatus('Återställt autosparat utkast');
      } catch {}
    }
  }
}

function setChapterStatus(txt, isError=false) {
  const el = document.getElementById('chapterStatus');
  if (!el) return;
  el.textContent = txt || '';
  el.style.color = isError ? '#f88' : '#7fbf7f';
}

async function saveChapter() {
  const title = document.getElementById('bkTitle').value.trim();
  const text = document.getElementById('chapterText').value;
  if (!title) return setChapterStatus('Ange titel först', true);
  if (!text || !text.trim()) return setChapterStatus('Kapiteltext tom', true);

  if (!currentStoryId) {
    currentStoryId = crypto.randomUUID();
    localStorage.setItem('bn_current_story', currentStoryId);
  }

  // determine chapter index if missing
  if (!currentChapterIndex) {
    let nextIdx = 1;
    try {
      const ch = await fetch(`${API_BASE}/api/chapters?story_id=${encodeURIComponent(currentStoryId)}`).then(r=>r.json()).catch(()=>({ok:false}));
      nextIdx = (ch?.data?.length) ? (Math.max(...ch.data.map(c=>c.chapter_index)) + 1) : 1;
    } catch {}
    currentChapterIndex = nextIdx;
  }

  const payload = { story_id: currentStoryId, title, chapter_index: currentChapterIndex, text };
  try {
    const resp = await fetch(`${API_BASE}/api/chapter/save`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload),
    });
    const j = await resp.json();
    if (j?.ok) {
      setChapterStatus(`Kapitel ${currentChapterIndex} sparat på servern.`);
      // clear local autosave for this chapter
      localStorage.removeItem(`bn_autosave_${currentStoryId}_ch${currentChapterIndex}`);
      // prepare for next chapter
      currentChapterIndex = currentChapterIndex + 1;
      document.getElementById('chapterText').value = '';
    } else {
      throw new Error(j?.error || 'save failed');
    }
  } catch (e) {
    // fallback: save locally
    const key = `bn_localchapter_${currentStoryId}_ch${currentChapterIndex || 1}`;
    const obj = { id: crypto.randomUUID(), story_id: currentStoryId, chapter_index: currentChapterIndex || 1, text, created_at: new Date().toISOString(), offline:true };
    localStorage.setItem(key, JSON.stringify(obj));
    setChapterStatus('Nätverksfel — sparat lokalt som utkast', true);
    currentChapterIndex = (currentChapterIndex || 1) + 1;
    document.getElementById('chapterText').value = '';
  }
}

async function generateContinuation() {
  if (!currentStoryId) {
    // create placeholder story id and save title
    currentStoryId = crypto.randomUUID();
    localStorage.setItem('bn_current_story', currentStoryId);
  }
  const mins = parseInt(document.getElementById('genMinutes').value, 10) || 5;
  const currentText = document.getElementById('chapterText').value || '';
  setChapterStatus('Genererar fortsättning…');

  try {
    const resp = await fetch(`${API_BASE}/api/story/continue`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ story_id: currentStoryId, current_text: currentText, desired_minutes: mins }),
    });
    const j = await resp.json();
    if (j?.ok && j.data?.next_chapter_text) {
      // append generated text
      document.getElementById('chapterText').value = currentText + (currentText ? '\n\n' : '') + j.data.next_chapter_text;
      setChapterStatus('AI‑förslag infogat i editorn');
    } else {
      setChapterStatus('Ingen fortsättning mottagen', true);
    }
  } catch (e) {
    setChapterStatus('Fel vid anrop för generering', true);
  }
}

async function listChapters() {
  if (!currentStoryId) return setChapterStatus('Ingen berättelse vald', true);
  try {
    const resp = await fetch(`${API_BASE}/api/chapters?story_id=${encodeURIComponent(currentStoryId)}`);
    const j = await resp.json();
    const container = document.getElementById('chapterList');
    container.innerHTML = '';
    if (j?.ok && Array.isArray(j.data) && j.data.length) {
      j.data.forEach(c => {
        const div = document.createElement('div');
        div.style.padding = '8px';
        div.style.border = '1px solid #222';
        div.style.marginBottom = '6px';
        div.innerHTML = `<strong>Kapitel ${c.chapter_index}</strong> <div style="font-size:0.9em;color:#9f9">${c.created_at || ''}</div><div style="white-space:pre-wrap;margin-top:6px;">${escapeHtml(truncate(c.text || '', 800))}</div>`;
        container.appendChild(div);
      });
      setChapterStatus(`Visar ${j.data.length} kapitel`);
    } else {
      // fall back to local saved drafts
      const keys = Object.keys(localStorage).filter(k=>k.startsWith(`bn_localchapter_${currentStoryId}_`)).sort();
      if (!keys.length) container.innerHTML = '<div class="small">Inga kapitel hittades.</div>';
      keys.forEach(k=>{
        const o = JSON.parse(localStorage.getItem(k));
        const div = document.createElement('div');
        div.style.padding = '8px';
        div.style.border = '1px solid #222';
        div.style.marginBottom = '6px';
        div.innerHTML = `<strong>Kapitel ${o.chapter_index}</strong><div style="font-size:0.9em;color:#9f9">${o.created_at}</div><div style="white-space:pre-wrap;margin-top:6px;">${escapeHtml(truncate(o.text || '', 800))}</div>`;
        container.appendChild(div);
      });
      setChapterStatus('Visar lokala utkast');
    }
  } catch (e) {
    setChapterStatus('Fel vid hämtning av kapitel', true);
  }
}

/* small helpers */
function escapeHtml(s){ if(!s) return ''; return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }
function truncate(s,n){ if(!s) return ''; return s.length>n? s.slice(0,n)+'…': s; }

/* Speech recognition setup */
let recognition = null;
function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { document.getElementById('btnRecord')?.setAttribute('disabled','disabled'); return; }
  recognition = new SpeechRecognition();
  recognition.lang = 'sv-SE';
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onresult = (evt) => {
    let final = '';
    for (let i = evt.resultIndex; i < evt.results.length; ++i) {
      if (evt.results[i].isFinal) final += evt.results[i][0].transcript;
    }
    if (final) {
      const ta = document.getElementById('chapterText');
      ta.value = (ta.value ? ta.value + '\n' : '') + final;
    }
  };
  const btn = document.getElementById('btnRecord');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (recognition && recognition.running) { recognition.stop(); recognition.running = false; btn.textContent = 'Rösta in'; }
    else { recognition.start(); recognition.running = true; btn.textContent = 'Stoppa inspelning'; }
  });
}

/* ---------------- Init ---------------- */
window.addEventListener('DOMContentLoaded', () => {
  $("status").addEventListener("click", statusPing);
  $("go").addEventListener("click", generate);
  // auto-status vid start
  statusPing();
  // init chapter module
  initChapterModule();
  // expose for debugging
  window.generate = generate;
});
