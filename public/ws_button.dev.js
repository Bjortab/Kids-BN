// ==========================================================
// BN-KIDS WS DEV — ws_button.dev.js (GC v3)
// Extra knapp "Skapa saga (WS dev)" = kapitelboksläge
// Använder worldstate.dev.js (WS_DEV-*)
// ==========================================================

(function () {
  function log(...args) {
    console.log("[WS DEV]", ...args);
  }

  function q(sel) {
    return document.querySelector(sel);
  }

  function showSpinner(show, text) {
    try {
      const spinner = q("[data-id='spinner']");
      if (!spinner) return;

      const txt = spinner.querySelector("[data-id='spinner-text']");
      if (txt && text) txt.textContent = text;

      spinner.style.display = show ? "flex" : "none";
    } catch (e) {
      console.warn("[WS DEV] spinner error", e);
    }
  }

  // Hämta berättelse-rutan
  function getStoryElement() {
    return (
      q("[data-id='story']") ||
      q("#story") ||
      q("#story-output") ||
      q("pre")
    );
  }

  function getPromptElement() {
    return q("[data-id='prompt']");
  }

  // Visa fel på samma ställe som övriga fel
  function setError(msg) {
    const el = q("[data-id='error']");
    if (!el) return;
    el.textContent = msg || "";
    if (msg) el.style.display = "block";
  }

  // Koppla "Rensa"-knappen till WS_DEV.reset
  function bindResetButton() {
    const byData = q("[data-id='btn-reset']");
    let btn = byData;

    if (!btn) {
      // Fallback: hitta knapp med text "Rensa"
      const all = Array.from(document.querySelectorAll("button"));
      btn = all.find((b) =>
        (b.textContent || "").trim().toLowerCase() === "rensa"
      );
    }

    if (!btn) {
      log("hittar ingen Rensa-knapp att binda mot (bok reset)");
      return;
    }

    btn.addEventListener("click", function () {
      try {
        if (window.WS_DEV && typeof window.WS_DEV.reset === "function") {
          window.WS_DEV.reset();
          log("bok reset via Rensa-knappen");
        }
      } catch (e) {
        console.warn("[WS DEV] reset via Rensa gav fel", e);
      }
    });
  }

  // Huvudhandler för WS-dev-knappen
  async function handleWsClick(ev) {
    ev.preventDefault();
    setError("");

    if (!window.WS_DEV) {
      setError("WS_DEV saknas (worldstate.dev.js laddades inte).");
      return;
    }

    const storyEl = getStoryElement();
    const promptEl = getPromptElement();

    // Läs ev. önskemål från prompt-rutan
    const wish = promptEl && promptEl.value ? promptEl.value.trim() : "";

    // 1) Ladda ev. befintlig bok
    let state = window.WS_DEV.load();

    // 2) Om ingen bok: skapa från formuläret
    if (!state) {
      state = window.WS_DEV.createWorldFromForm();
      // spara initialt önskemål om det finns
      if (wish) state.last_prompt = wish;
      window.WS_DEV.save(state);
      log("skapade ny bok från formulär", state);
    } else if (wish) {
      // uppdatera senaste önskemål
      state.last_prompt = wish;
      window.WS_DEV.save(state);
    }

    // 3) Bygg prompt för nästa kapitel
    const wantEnding = false; // vi kan styra detta senare via egen UI
    const prompt = window.WS_DEV.buildPrompt(state, {
      wish,
      wantEnding
    });

    // 4) Skicka till /api/generate_story
    const meta = state.meta || {};
    const body = {
      age: meta.ageValue || "",
      hero: meta.hero || "",
      mins: meta.lengthValue || "medium",
      prompt,
      lang: "sv",
      engine: "chat",
      ws_mode: "chapters"
    };

    showSpinner(true, "Skapar nästa kapitel ...");

    try {
      const res = await fetch("/api/generate_story", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(body)
      });

      let data;
      try {
        data = await res.json();
      } catch (e) {
        const txt = await res.text();
        console.warn("[WS DEV] kunde inte läsa JSON, råtext:", txt);
        throw new Error("Kunde inte läsa JSON från sagomotorn.");
      }

      if (!res.ok) {
        throw new Error(
          (data && data.error) ||
            "Sagomotorn svarade med fel (" + res.status + ")."
        );
      }

      if (!data || !data.story) {
        throw new Error("Svaret saknar 'story'-fält.");
      }

      const chapterText = String(data.story || "").trim();
      if (!chapterText) {
        throw new Error("Tomt kapitel i svaret.");
      }

      // 5) Visa kapitlet i berättelse-rutan
      if (storyEl) {
        storyEl.textContent = chapterText;
      }

      // 6) Lägg till kapitel i boken + spara
      state = window.WS_DEV.addChapter(state, chapterText);
      window.WS_DEV.save(state);

      const chCount = Array.isArray(state.chapters)
        ? state.chapters.length
        : 0;
      log("chapters now:", Array.from({ length: chCount }, (_, i) => i + 1));
    } catch (err) {
      console.error("[WS DEV] fel:", err);
      setError("Något gick fel i WS-läget: " + (err.message || err));
    } finally {
      showSpinner(false);
    }
  }

  // -------------------------------------------------------
  // Init när sidan laddats
  // -------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    try {
      const wsBtn =
        q("[data-id='btn-ws-dev']") ||
        Array.from(document.querySelectorAll("button")).find((b) =>
          (b.textContent || "")
            .toLowerCase()
            .includes("ws dev")
        );

      if (!wsBtn) {
        log("hittar ingen WS-dev-knapp i DOM:en");
        return;
      }

      wsBtn.addEventListener("click", handleWsClick);
      log("WS-knapp bunden");

      bindResetButton();
    } catch (e) {
      console.error("[WS DEV] init-fel:", e);
    }
  });
})();
