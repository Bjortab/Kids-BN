(() => {
  function qs(sel) { return document.querySelector(sel); }
  const ui = {
    age:   qs('[data-id="age"]'),
    hero:  qs('[data-id="hero"]'),
    prompt:qs('[data-id="prompt"]'),
    btnCreate: qs('[data-id="btn-create"]') || qs('#btn-create'),
    btnTts:    qs('[data-id="btn-tts"]')    || qs('#btn-tts'),
    story:  qs('[data-id="story"]'),
    audio:  qs('[data-id="audio"]'),
    err:    qs('[data-id="error"]'),
    spin:   qs('[data-id="spinner"]'),
    status: qs('[data-id="status"]'),
  };

  function setBusy(b, text="Arbetar…") {
    if (ui.spin) ui.spin.style.display = b ? "inline-flex" : "none";
    if (ui.status) ui.status.textContent = b ? text : "";
    if (ui.btnCreate) ui.btnCreate.disabled = b;
    if (ui.btnTts)    ui.btnTts.disabled    = b;
  }
  function showErr(msg) {
    if (!ui.err) return;
    ui.err.textContent = msg || "";
    ui.err.style.display = msg ? "block" : "none";
  }
  function setStory(text) {
    if (ui.story) ui.story.textContent = text || "";
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok) {
      const body = ct.includes("application/json")
        ? await res.json().catch(()=> ({}))
        : await res.text().catch(()=> "");
      throw new Error(
        "Serverfel " + res.status + ": " +
        (typeof body === "string" ? body.slice(0,400) : JSON.stringify(body))
      );
    }
    return ct.includes("application/json") ? res.json() : res.text();
  }

  async function onCreateClick(e) {
    e?.preventDefault();
    showErr("");
    setStory("");

    const age = (ui.age?.value || "").trim();
    const hero = (ui.hero?.value || "").trim();
    const prompt = (ui.prompt?.value || "").trim();

    if (!age)   return showErr("Välj ålder.");
    if (!prompt) return showErr("Skriv vad sagan ska handla om.");

  const url = new URL('/api/generate_story', window.location.origin);
url.search = new URLSearchParams({
  age:    (age || '').trim(),
  hero:   (hero || '').trim(),
  prompt: (prompt || '').trim()
}).toString();

const res = await fetch(url.toString(), {
  method: 'GET',
  headers: { 'Accept': 'application/json' }
});

    setBusy(true, "Skapar saga…");
    try {
      const data = await fetchJSON(url.toString());
      const story = typeof data === "string" ? data : (data.story || data.text || "");
      if (!story) throw new Error("Tomt svar från servern.");
      setStory(story);
    } catch (err) {
      showErr(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function onTtsClick(e) {
    e?.preventDefault();
    showErr("");
    const text = (ui.story?.textContent || "").trim();
    if (!text) return showErr("Ingen berättelse att läsa upp ännu.");
    // Här kan du koppla mot /tts eller /tts_vertex senare.
    // Placeholder: vi nollställer ev buffert.
    ui.audio?.removeAttribute("src");
    showErr("TTS är inte kopplad i denna version. (Berättelsen fungerar.)");
  }

  // Robust event binding: vänta till DOM är klar OCH använd delegation fallback.
  function bindEvents() {
    ui.btnCreate?.addEventListener("click", onCreateClick);
    ui.btnTts?.addEventListener("click", onTtsClick);

    // Fallback: om någon byter markup/text:
    document.addEventListener("click", (ev) => {
      const t = ev.target;
      if (!t) return;
      const label = (t.textContent || "").trim().toLowerCase();
      if (label.startsWith("skapa saga")) onCreateClick(ev);
      if (label.startsWith("läs upp")) onTtsClick(ev);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    setBusy(false);
    showErr("");
    bindEvents();
  });
})();
