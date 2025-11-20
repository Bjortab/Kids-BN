// ===============================
// BN-KIDS — WORLDSTATE.DEV.JS (V10 PREP)
// ===============================
// OBS: Får EJ bryta GC-laddning, HTML-ID:n, event-bindings eller story_engine-API:t.
// Säkerställd enligt checklistan. GC laddas före denna. 
// ===============================

(function () {
    console.log("[WS DEV] worldstate.dev.js laddad (V10) ✔");

    // -------------------------------
    // 1. Hämta befintligt worldstate eller skapa nytt
    // -------------------------------
    let ws = window.BN_WS || {
        book: null,
        chapters: [],
        last_prompt: "",
        age_band: null,
        length_preset: null,
        tone_preset: null,
        story_mode: "chapter_book",
        continue_story: false,
        force_end: false,
        knowledge_priority: "balanced",
        disable_moralizing: true
    };

    // Exponera för debug
    window.BN_WS = ws;

    // -------------------------------
    // 2. Funktion att nollställa allt
    // -------------------------------
    window.BN_resetBook_DEV = function () {
        console.log("[WS DEV] RESET BOOK");
        ws.book = null;
        ws.chapters = [];
        ws.last_prompt = "";
        ws.continue_story = false;
        ws.force_end = false;
        ws.knowledge_priority = "balanced";
        ws.disable_moralizing = true;
        updateUI_WS_dev();
    };

    // -------------------------------
    // 3. Spara prompt för kapitel-logik
    // -------------------------------
    window.BN_setPrompt_DEV = function (text) {
        ws.user_prompt = text.trim();
        console.log("[WS DEV] Ny prompt satt:", ws.user_prompt);
    };

    // -------------------------------
    // 4. Sätta ålder
    // -------------------------------
    window.BN_setAgeBand_DEV = function (ageBandId) {
        ws.age_band = ageBandId;
        console.log("[WS DEV] Åldersband satt:", ws.age_band);
    };

    // -------------------------------
    // 5. Längdinställning
    // -------------------------------
    window.BN_setLengthPreset_DEV = function (presetId) {
        ws.length_preset = presetId;
        console.log("[WS DEV] Längdpreset satt:", ws.length_preset);
    };

    // -------------------------------
    // 6. Toninställning
    // -------------------------------
    window.BN_setTonePreset_DEV = function (presetId) {
        ws.tone_preset = presetId;
        console.log("[WS DEV] Ton-preset satt:", ws.tone_preset);
    };

    // -------------------------------
    // 7. Nyckellogik: fortsättning vs. ny berättelse
    // -------------------------------
    function computeContinueFlag() {
        if (!ws.last_prompt || !ws.user_prompt) return false;

        const p1 = ws.last_prompt.trim().toLowerCase();
        const p2 = ws.user_prompt.trim().toLowerCase();

        const same = p1 === p2;

        console.log("[WS DEV] continue calc:", { p1, p2, same });

        return same;
    }

    // -------------------------------
    // 8. Förbereda payload till story_engine
    // -------------------------------
    window.BN_buildStoryPayload_DEV = function () {
        const continueFlag = computeContinueFlag();
        ws.continue_story = continueFlag;

        const payload = {
            story_mode: ws.story_mode,
            age_band: ws.age_band,
            length_preset: ws.length_preset,
            tone_preset: ws.tone_preset,

            user_prompt: ws.user_prompt,
            last_prompt: ws.last_prompt,

            continue_story: continueFlag,
            force_end: ws.force_end,

            chapters_so_far: ws.chapters.length,
            previous_chapter_text: ws.chapters[ws.chapters.length - 1] || "",

            disable_moralizing: ws.disable_moralizing,
            knowledge_priority: ws.knowledge_priority
        };

        console.log("[WS DEV] Payload byggd:", payload);
        return payload;
    };

    // -------------------------------
    // 9. När ett nytt kapitel kommit tillbaka från backend
    // -------------------------------
    window.BN_registerNewChapter_DEV = function (text) {
        console.log("[WS DEV] Registrerar nytt kapitel");
        ws.chapters.push(text);
        ws.last_prompt = ws.user_prompt;
        ws.force_end = false;
        updateUI_WS_dev();
    };

    // -------------------------------
    // 10. UI uppdatering (lätt)
    // -------------------------------
    function updateUI_WS_dev() {
        const el = document.getElementById("ws-dev-view");
        if (!el) return;
        el.innerText = JSON.stringify(ws, null, 2);
    }

})();
