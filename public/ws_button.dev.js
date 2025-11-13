// ============================================================
// BN-KIDS WS DEV — ws_button.dev.js (v2)
// Extra blå knapp: "Skapa saga (WS dev)"
// Kör separat från din vanliga "Skapa saga"
// ============================================================

(function () {

  function $(s) { return document.querySelector(s); }

  function showSpinner(active, text) {
    const spinner = document.querySelector("[data-id='spinner']");
    if (spinner) {
      spinner.style.display = active ? "flex" : "none";
      spinner.textContent = active ? (text || "Skapar kapitel (WS dev)...") : "";
      return;
    }
    // fallback – skriv i story-rutan
    const out = $("[data-id='story']");
    if (!out) return;
    if (active) {
      out.innerHTML = "<p style='opacity:0.6'>⏳ " + (text || "Skapar kapitel (WS dev)...") + "</p>";
    }
  }

  async function createWSChapter() {
    const errEl   = $("[data-id='error']");
    const storyEl = $("[data-id='story']");

    try {
      if (!window.WS_DEV) {
        throw new Error("WS_DEV saknas (worldstate.dev.js inte laddad?)");
      }

      // 1. Ladda befintlig bok eller skapa ny
      let state = window.WS_DEV.load();
      if (!state) {
        state = window.WS_DEV.createWorldFromForm();
        if (!state) throw new Error("Kunde inte skapa world state från formuläret.");
      }

      // 2. Bygg prompt baserat på WS
      const wsPrompt = window.WS_DEV.buildWsPrompt(state);
      if (!wsPrompt) throw new Error("WS prompt blev tom.");

      showSpinner(true, "Skapar kapitel (WS dev)...");

      const ageValue = state.meta && state.meta.ageValue ? state.meta.ageValue : "";
      const heroName = state.meta && state.meta.hero ? state.meta.hero : "";

      const body = {
        age: ageValue,
        mins: 5,
        lang: "sv",
        prompt: wsPrompt,
        hero: heroName
      };

      // 3. Anropa din befintliga backend
      const res = await fetch("/api/generate_story", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(body)
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.warn("[WS] ogiltigt JSON-svar:", text.slice(0, 200));
        throw new Error("WS: ogiltigt JSON-svar från servern.");
      }

      const chapter =
        data.story ||
        data.text ||
        data.story_text ||
        (data.data && (data.data.story || data.data.story_text)) ||
        "";

      if (!chapter) {
        console.warn("[WS] Svar saknar story-fält", data);
        throw new Error("WS: servern skickade ingen berättelsetext.");
      }

      // 4. Spara kapitlet i WS
      state = window.WS_DEV.addChapterToWS(state, chapter);
      window.WS_DEV.save(state);

      // 5. Visa texten i samma ruta som vanligt
      if (storyEl) storyEl.textContent = chapter;

      if (errEl) errEl.textContent = "";

    } catch (e) {
      console.error("[WS dev error]", e);
      if (errEl) errEl.textContent = e.message || "WS: kunde inte skapa kapitel.";
      if (storyEl && !storyEl.textContent) {
        storyEl.textContent = "Något gick fel i WS dev: " + (e.message || e.toString());
      }
    } finally {
      showSpinner(false);
    }
  }

  function injectWSButton() {
    // Hitta din befintliga "Skapa saga"-knapp och lägg WS-knapp bredvid
    const createBtn = document.querySelector("[data-id='btn-create']");
    if (!createBtn || !createBtn.parentNode) {
      console.warn("[WS] Hittar inte knappen data-id='btn-create'");
      return;
    }

    // Skapa bara om den inte redan finns
    if (document.querySelector("[data-id='btn-create-ws-dev']")) return;

    const btn = document.createElement("button");
    btn.setAttribute("data-id", "btn-create-ws-dev");
    btn.type = "button";
    btn.textContent = "Skapa saga (WS dev)";
    btn.className = "btn-secondary"; // blå variant enligt din stil
    btn.style.marginLeft = "8px";

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      createWSChapter();
    });

    // Lägg direkt efter din ordinarie skapa-knapp
    createBtn.parentNode.insertBefore(btn, createBtn.nextSibling);
  }

  window.addEventListener("DOMContentLoaded", injectWSButton);

})();
