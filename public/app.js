<!-- public/app.js -->
<script>
(() => {
  const els = {
    age: document.querySelector('[data-id="age"]'),
    hero: document.querySelector('[data-id="hero"]'),
    prompt: document.querySelector('[data-id="prompt"]'),
    btnCreate: document.querySelector('[data-id="btn-create"]'),
    btnTestTts: document.querySelector('[data-id="btn-test-voice"]'),
    storyBox: document.querySelector('[data-id="story"]'),
    status: document.querySelector('[data-id="status"]'),
    error: document.querySelector('[data-id="error"]'),
    spinner: document.querySelector('[data-id="spinner"]'),
  };

  function setBusy(isBusy, label = "Arbetar…") {
    if (!els.spinner) return;
    els.spinner.style.display = isBusy ? "inline-flex" : "none";
    els.status.textContent = isBusy ? label : "";
    [els.btnCreate, els.btnTestTts].forEach(b => b && (b.disabled = isBusy));
  }

  function showError(msg) {
    if (!els.error) return;
    els.error.textContent = msg;
    els.error.style.display = msg ? "block" : "none";
  }

  function showStory(text) {
    els.storyBox.textContent = text || "";
  }

  async function createStory() {
    showError("");
    showStory("");
    const age = (els.age?.value || "").trim();
    const hero = (els.hero?.value || "").trim();
    const prompt = (els.prompt?.value || "").trim();

    if (!age) {
      showError("Välj ålder.");
      return;
    }
    if (!prompt) {
      showError("Skriv vad sagan ska handla om.");
      return;
    }

    // Bygg URL robust med URL & URLSearchParams (så vi aldrig tappar &)
    const url = new URL("/api/generate_story", window.location.origin);
    const qs = new URLSearchParams({
      age,
      hero,               // kan vara tom sträng
      prompt
    });
    url.search = qs.toString();

    setBusy(true, "Skapar saga…");
    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { "accept": "application/json" }
      });

      // Cloudflare Pages Functions kan returnera HTML vid fel; hantera båda
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok) {
        const body = contentType.includes("application/json")
          ? await res.json().catch(() => ({}))
          : await res.text().catch(() => "");
        throw new Error(
          "Serverfel (" + res.status + "): " +
          (typeof body === "string" ? body.slice(0, 400) : JSON.stringify(body))
        );
      }

      const data = contentType.includes("application/json")
        ? await res.json()
        : { story: await res.text() };

      const story = data.story || data.text || "";
      if (!story) {
        throw new Error("Tomt svar från generate_story.");
      }
      showStory(story);
    } catch (err) {
      showError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  }

  // Hooka upp knappen
  els.btnCreate?.addEventListener("click", (e) => {
    e.preventDefault();
    createStory();
  });

  // Init UI
  showError("");
  setBusy(false);
})();
</script>
