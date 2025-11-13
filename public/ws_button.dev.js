// ============================================================
// BN-KIDS WS DEV — ws_button.dev.js (v1)
// Extra knapp: "Skapa nästa kapitel (WS dev)"
// ============================================================

(function () {

  function $(s) { return document.querySelector(s); }

  // Placera spinner i output
  function showSpinner(active) {
    const out = $("[data-id='story']");
    if (!out) return;
    if (active) out.innerHTML = "<p style='opacity:0.6'>⏳ Skapar kapitel…</p>";
  }

  // ---------------------------------------------------------
  // Huvudfunktion: skapa WS-kapitel
  // ---------------------------------------------------------
  async function createWSChapter() {
    try {
      // 1. Ladda befintlig bok
      let state = window.WS_DEV.load();

      // 2. Om ingen bok finns -> skapa ny från formuläret
      if (!state) {
        state = window.WS_DEV.createWorldFromForm();
      }

      // 3. Bygg prompt
      const wsPrompt = window.WS_DEV.buildWsPrompt(state);

      showSpinner(true);

      // 4. Skicka till backend
      const body = {
        age: state.meta.age,
        mins: 5,
        lang: "sv",
        prompt: wsPrompt,
        hero: state.meta.hero
      };

      const res = await fetch("/api/generate_story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const data = await res.json().catch(() => null);

      if (!data || !data.story) {
        throw new Error("WS dev: API saknar story");
      }

      const chapter = data.story;

      // 5. Spara i worldstate
      window.WS_DEV.addChapterToWS(state, chapter);
      window.WS_DEV.save(state);

      // 6. Visa text
      const out = $("[data-id='story']");
      if (out) out.textContent = chapter;

    } catch (e) {
      console.error("[WS dev error]", e);
      const out = $("[data-id='story']");
      if (out) out.textContent = "Kunde inte skapa WS-kapitel: " + e.message;
    }
  }

  // ---------------------------------------------------------
  // Lägg till WS-knappen i UI på ett snyggt sätt
  // ---------------------------------------------------------
  function injectWSButton() {
    const parent = document.querySelector(".row[style*='margin-top:12px']");
    if (!parent) return;

    const btn = document.createElement("button");
    btn.className = "btn-secondary";
    btn.style.marginLeft = "10px";
    btn.textContent = "Skapa saga (WS dev)";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      createWSChapter();
    });

    parent.appendChild(btn);
  }

  // Starta
  window.addEventListener("DOMContentLoaded", injectWSButton);

})();
