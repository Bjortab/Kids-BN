// ===============================================================
// BN-KIDS — STORY ENGINE (DEV v10.3)
// Författarprofil: "BN-författaren" (flow, små skämt, varm ton)
// ---------------------------------------------------------------
// Mål:
// - Följa barnets prompt & tema stenhårt (Focus Lock Engine / FLE)
// - Hålla röd tråd mellan kapitel (ingen "ny saga"-känsla)
// - Åldersanpassad ton (7–9 vs 10–12), 13–15 pausad för framtiden
// - Mindre moral-kakor, mer handling & känslor i scenen
// - Humor: små, varma, oväntade formuleringar (typ "kreativ landning")
// - Romantik: bara 10–12, bara när det passar, alltid barnvänligt
//
// Exponeras som: window.BNStoryEngine
// Används av: generateStory_ip.js (IP-wrappern) m.fl.
//
// Viktigt:
// - Denna fil ska laddas FÖRE generateStory_ip.js i index.html
// ===============================================================

(function (global) {
  "use strict";

  const ENGINE_VERSION = "bn-story-engine-v10_3";

  // ------------------------------------------------------------
  // Hämta ev. BN_STORY_CONFIG från global (om du lagt in JSON-konfig)
  // ------------------------------------------------------------
  const CONFIG = global.BN_STORY_CONFIG || {};
  const CFG_ROOT = CONFIG.bn_kids_story_config || {};
  const CFG_AGE_BANDS = CFG_ROOT.age_bands || {};
  const CFG_LENGTH = CFG_ROOT.length_presets || {};

  // ------------------------------------------------------------
  // Fallback-agebands om JSON-konfig inte finns eller är tom
  // ------------------------------------------------------------
  const FALLBACK_BANDS = {
    junior_7_9: {
      id: "junior_7_9",
      label: "7–9 år",
      chapter_words_target: 650,
      chapter_words_min: 450,
      chapter_words_max: 800,
      tone:
        "enkel, trygg, humoristisk ton med korta meningar och konkreta bilder. Inga subplots.",
      violence_level: "none_soft",
      romance_level: "none"
    },
    mid_10_12: {
      id: "mid_10_12",
      label: "10–12 år",
      chapter_words_target: 1100,
      chapter_words_min: 800,
      chapter_words_max: 1500,
      tone:
        "äventyrlig men trygg, mer känslor och lite djupare relationer. Max en enkel subplot.",
      violence_level: "soft_fantasy",
      romance_level: "crush_only"
    }
    // teen_13_15 finns i designen men är pausad i denna version
  };

  // ------------------------------------------------------------
  // Hjälp: plocka age band utifrån meta.age / ageValue / ageLabel
  // ------------------------------------------------------------
  function pickAgeBand(meta) {
    const rawAge =
      (meta && (meta.ageValue || meta.age || meta.ageLabel)) || "";
    const m = String(rawAge).match(/(\d{1,2})/);
    const age = m ? parseInt(m[1], 10) : 11;

    let bandId;
    if (age <= 9) bandId = "junior_7_9";
    else if (age <= 12) bandId = "mid_10_12";
    else {
      // 13–15: vi mappar tills vidare också till mid_10_12, men kan särskiljas senare
      bandId = "mid_10_12";
    }

    const cfg = CFG_AGE_BANDS[bandId] || FALLBACK_BANDS[bandId];

    const target =
      (cfg && cfg.chapter_words_target) ||
      (cfg && cfg.chapter_words_min && cfg.chapter_words_max
        ? Math.round((cfg.chapter_words_min + cfg.chapter_words_max) / 2)
        : 1000);

    // Grov tumregel: ~6 tecken per ord
    const maxChars =
      cfg && cfg.chapter_words_max
        ? cfg.chapter_words_max * 6
        : target * 6;

    return {
      id: bandId,
      label: (cfg && cfg.label) || (bandId === "junior_7_9" ? "7–9 år" : "10–12 år"),
      wordGoal: target,
      maxChars: maxChars,
      tone: (cfg && cfg.tone) || "",
      violence_level: (cfg && cfg.violence_level) || "",
      romance_level: (cfg && cfg.romance_level) || ""
    };
  }

  // ------------------------------------------------------------
  // Längdpreset (Kort / Lagom / Lång) utifrån meta.lengthValue
  // ------------------------------------------------------------
  function resolveLengthPreset(meta, ageBandId) {
    const defaultPreset = "medium";
    const lp =
      (meta && (meta.lengthValue || meta.lengthPreset || meta.length)) ||
      defaultPreset;

    const presetKey = /kort/i.test(lp)
      ? "short"
      : /lång/i.test(lp)
      ? "long"
      : "medium";

    const bandKey = ageBandId || "mid_10_12";
    const preset =
      CFG_LENGTH[presetKey] &&
      CFG_LENGTH[presetKey].word_ranges_by_band &&
      CFG_LENGTH[presetKey].word_ranges_by_band[bandKey];

    if (!preset) {
      // Fallback: ungefärliga ordintervall
      if (presetKey === "short") {
        return { id: "short", min: 400, max: 900, label: "Kort" };
      }
      if (presetKey === "long") {
        return { id: "long", min: 1200, max: 2200, label: "Lång" };
      }
      return { id: "medium", min: 800, max: 1600, label: "Lagom" };
    }

    return {
      id: presetKey,
      min: preset.min,
      max: preset.max,
      label: CFG_LENGTH[presetKey].label || presetKey
    };
  }

  // ------------------------------------------------------------
  // Trimma bort halv mening (klipp i slutet)
  // ------------------------------------------------------------
  function trimToWholeSentence(text) {
    let t = (text || "").trim();
    const lastDot = Math.max(
      t.lastIndexOf("."),
      t.lastIndexOf("!"),
      t.lastIndexOf("?")
    );
    if (lastDot !== -1) return t.slice(0, lastDot + 1);
    return t;
  }

  // ------------------------------------------------------------
  // Hjälp: kolla om barnet verkar vilja avsluta boken
  // ------------------------------------------------------------
  function detectWantsEnding(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    if (
      lower.includes("sista kapitlet") ||
      lower.includes("avsluta boken") ||
      lower.includes("avsluta berättelsen") ||
      lower.includes("ge ett slut") ||
      lower.includes("knyt ihop allt")
    ) {
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------
  // Bygg intern recap (om storyState eller worldState har info)
  // ------------------------------------------------------------
  function buildRecap(worldState, storyState, chapterIndex) {
    if (chapterIndex === 1) {
      return "Det finns inga tidigare kapitel. Detta är starten på berättelsen.";
    }

    // Om storyState har en AI-skapad sammanfattning
    if (storyState && typeof storyState.previousSummary === "string") {
      const txt = storyState.previousSummary.trim();
      if (txt) {
        return (
          "Kort sammanfattning av vad som hänt hittills (håll dig till detta och bygg vidare, börja inte om):\n" +
          txt
        );
      }
    }

    // Om storyState sparat tidigare kapitel som array av texter
    if (storyState && Array.isArray(storyState.previousChapters)) {
      const arr = storyState.previousChapters.filter(
        (t) => typeof t === "string" && t.trim()
      );
      if (arr.length > 0) {
        const last = arr[arr.length - 1];
        const first = arr[0];
        const recap =
          "Så här började berättelsen:\n" +
          first.slice(0, 600) +
          "\n\nSå här slutade senaste kapitlet, fortsätt exakt härifrån:\n" +
          last.slice(Math.max(0, last.length - 800));
        return recap;
      }
    }

    // Som fallback kan vi titta på worldState.chapters (från WS_DEV)
    if (worldState && Array.isArray(worldState.chapters)) {
      const chapters = worldState.chapters;
      if (chapters.length > 0) {
        const first = chapters[0].text || "";
        const last = chapters[chapters.length - 1].text || "";
        const recap =
          "Så här började berättelsen:\n" +
          first.slice(0, 600) +
          "\n\nSå här slutade senaste kapitlet, fortsätt exakt härifrån:\n" +
          last.slice(Math.max(0, last.length - 800));
        return recap;
      }
    }

    return "Tidigare kapitel finns, men ingen extra sammanfattning skickas. Fortsätt logiskt framåt från den senaste händelsen i berättelsen.";
  }

  // ------------------------------------------------------------
  // Bygg systemprompt / huvudprompt till modellen
  // ------------------------------------------------------------
  function buildPrompt(opts) {
    const { worldState, storyState, chapterIndex, ageBand, lengthPreset } =
      opts;

    const meta = worldState.meta || {};
    const hero = meta.hero || "hjälten";

    const ageLabel = ageBand.label || "7–12 år";

    // Barnets idé / prompt
    const childIdea =
      worldState._userPrompt ||
      worldState.last_prompt ||
      meta.originalPrompt ||
      "";

    const storyMode =
      worldState.story_mode ||
      (chapterIndex > 1 ? "chapter_book" : "single_story");

    const wantsEnding = detectWantsEnding(childIdea);
    const isFirstChapter = chapterIndex === 1;
    const recap = buildRecap(worldState, storyState, chapterIndex);

    // Ton / stil
    const toneLines = [];
    if (ageBand.tone) {
      toneLines.push("Ton: " + ageBand.tone);
    }
    if (ageBand.violence_level) {
      toneLines.push(
        "Våldsnivå: håll det på nivå \"" +
          ageBand.violence_level +
          "\". Inget grafiskt våld."
      );
    }
    if (ageBand.romance_level) {
      toneLines.push(
        "Romantik: nivå \"" +
          ageBand.romance_level +
          "\". Alltid barnvänligt, inget explicit innehåll."
      );
    }

    // FLE / Focus Lock: regler för att INTE tappa barnets tema
    const focusLockRules = [
      "Följ barnets prompt och tema mycket noggrant.",
      "Byt inte genre eller ton utan att barnet tydligt ber om det.",
      "Om barnet anger ett yrke (t.ex. detektiv, fotbollsspelare) ska kapitlet kretsa kring det yrket eller uppdraget.",
      "Om barnet nämner ett viktigt föremål (t.ex. en diamant, en ring, en drake) ska föremålet vara centralt tills konflikten är löst.",
      "Om barnet anger ett huvuduppdrag (t.ex. hitta något, vinna matchen, rädda någon) ska det synas i varje scen.",
      "Inför inte mörker, skräck, monster eller kuslig mystik om barnet inte specifikt ber om det.",
      "Håll dig inom åldersbandets trygghetsnivå."
    ];

    // Kapitellogik
    const chapterLogicLines = [];
    if (isFirstChapter) {
      chapterLogicLines.push(
        "Detta är kapitel 1. Du ska:",
        "- Introducera huvudpersonen " + hero + " tydligt.",
        "- Visa miljön där berättelsen börjar.",
        "- Göra huvudmålet eller huvudproblemet tydligt.",
        "- Skapa en känsla av att det finns mer att upptäcka, men inte lösa hela konflikten."
      );
    } else if (wantsEnding) {
      chapterLogicLines.push(
        "Detta kapitel ska fungera som det avslutande kapitlet i boken.",
        "- Knyt ihop huvudkonflikten på ett tydligt och barnvänligt sätt.",
        "- Lös det viktigaste problemet eller uppdraget.",
        "- Lämna inte kvar stora obesvarade huvudfrågor.",
        "- Introducera inte en ny stor konflikt i sista kapitlet.",
        "- Avsluta med en lugn, hoppfull eller varm känsla."
      );
    } else {
      chapterLogicLines.push(
        "Detta är ett mittenkapitel (kapitel " + chapterIndex + "). Du ska:",
        "- Fortsätta direkt från slutet av tidigare kapitel (utifrån sammanfattningen).",
        "- Inte starta om berättelsen från början.",
        "- Fördjupa konflikten, relationer eller uppdraget.",
        "- Låta små hinder och framsteg föra " + hero + " närmare eller längre från målet.",
        "- Avsluta med en tydlig scenavslutning, inte med en halv mening."
      );
    }

    // Romantik-logik (bara 10–12, och bara när det är relevant)
    const romanceLines = [];
    if (ageBand.id === "mid_10_12") {
      romanceLines.push(
        "Romantik och känslor (endast om det passar berättelsen):",
        "- Om barnets input tydligt handlar om kärlek, att vara kär eller relationer, får du använda oskyldig första-kärlek-nivå.",
        "- Första-kärlek-nivå betyder: fjärilar i magen, rodnad, vilja att imponera, hålla handen, fundera på om den andre gillar en tillbaka.",
        "- Ingen vuxen romantik, inget fokus på kropp, inget kyssande i detalj, inget sexuellt innehåll.",
        "- Om prompten inte nämner något romantiskt alls, fokuserar du istället på vänskap, mod, äventyr och uppdrag.",
        "- Romantik får aldrig ta över hela berättelsen om inte barnet mycket tydligt ber om en ren kärlekssaga."
      );
    } else {
      romanceLines.push(
        "För detta åldersband ska du inte skriva romantik. Fokusera på vänskap, familj, mod och äventyr."
      );
    }

    // Stilprofil "BN-författaren"
    const styleLines = [
      "Berättarstil (mycket viktigt):",
      "- Skriv på naturlig, levande svenska som om du berättar en riktig bok högt för barnet.",
      "- Var konkret: visa vad som händer genom handling och dialog, istället för att förklara allt i efterhand.",
      "- Använd korta och medellånga meningar blandat, så texten får ett bra flow.",
      "- Små, varma skämt är bra (t.ex. oväntade formuleringar som 'kreativ landning'), men överdriv inte.",
      "- Undvik moralpredikningar och långa föreläsningar om rätt och fel.",
      "- Låt i stället karaktärernas handlingar visa vad de lär sig.",
      "- Upprepa inte samma information om hjälten om och om igen (t.ex. att hen är stark, modig eller snäll).",
      "- Om hjälten lärt sig något viktigt (som att flyga, spela match, lösa ett fall), får hen inte plötsligt vara nybörjare igen utan tydlig orsak.",
      "- Skapa en känsla av närvaro i scenen: vad ser de, hör de, känner de i kroppen?"
    ];

    const lp = lengthPreset;

    const lines = [];

    lines.push(
      "Du är BN-Kids berättelsemotor i läge: kapitelbok/saga för barn.",
      "Din uppgift är att skriva nästa kapitel på svenska med hög kvalitet, samma känsla som en riktig författare."
    );

    lines.push("");
    lines.push("=== FOCUS LOCK ENGINE (FLE) ===");
    focusLockRules.forEach((r) => lines.push("- " + r));

    lines.push("");
    lines.push("=== ÅLDERSBAND & LÄNGD ===");
    lines.push("- Målgrupp: " + ageLabel + ".");
    lines.push(
      "- Sikta på ungefär " +
        ageBand.wordGoal +
        " ord i detta kapitel, inom intervallet " +
        lp.min +
        "–" +
        lp.max +
        " ord."
    );
    toneLines.forEach((t) => lines.push("- " + t));

    lines.push("");
    lines.push("=== BARNETS IDÉ / ÖNSKAN (MÅSTE RESPEKTERAS) ===");
    if (childIdea && childIdea.trim()) {
      lines.push(
        'Barnets prompt/idé är (håll dig nära detta tema genom hela kapitlet):'
      );
      lines.push('"' + childIdea.trim() + '"');
    } else {
      lines.push(
        "- Ingen extra önskan är specificerad, så bygg vidare på hjälten, miljön och huvudproblemet."
      );
    }

    lines.push("");
    lines.push("=== STORYLÄGE ===");
    if (storyMode === "chapter_book" || !isFirstChapter) {
      lines.push(
        "- Du skriver kapitel " +
          chapterIndex +
          " i en pågående kapitelbok (chapter_book-läge)."
      );
    } else {
      lines.push(
        "- Du skriver en fristående saga eller första kapitlet i en ny berättelse."
      );
    }

    lines.push("");
    lines.push("=== KAPITELLOGIK ===");
    chapterLogicLines.forEach((t) => lines.push("- " + t));

    lines.push("");
    lines.push("=== TIDIGARE HÄNDELSER (RECENT RECAP) ===");
    lines.push(recap);

    lines.push("");
    lines.push("=== ROMANTIK / RELATIONER ===");
    romanceLines.forEach((t) => lines.push("- " + t));

    lines.push("");
    lines.push("=== STIL & FLOW (BN-FÖRFATTAREN) ===");
    styleLines.forEach((t) => lines.push("- " + t));

    lines.push("");
    lines.push("=== ALLMÄNNA REGLER FÖR KONTINUITET ===");
    lines.push(
      "- Karaktärer ska inte byta namn, utseende eller roll utan mycket tydlig förklaring."
    );
    lines.push(
      "- Ett djur som är en kanin i ett kapitel får inte bli en hund i nästa utan att det förklaras i själva berättelsen."
    );
    lines.push(
      "- Håll koll på viktiga föremål (ringar, drakar, klubbar, hemliga baser) så de används konsekvent."
    );
    lines.push(
      "- Huvuduppdraget (t.ex. hitta något, vinna matchen, lösa gåtan) ska märkas i varje kapitel tills det är löst."
    );

    lines.push("");
    lines.push("=== SVARSFORMAT ===");
    lines.push(
      "Svara med enbart själva kapiteltexten i löpande text (ingen JSON, inga förklaringar, inga rubriker som 'Kapitel 3')."
    );
    lines.push("Börja direkt med berättelsen.");

    return lines.join("\n");
  }

  // ------------------------------------------------------------
  // Hämta text från API-svar (OpenAI/Mistral kompatibelt)
  // ------------------------------------------------------------
  function extractModelText(apiResponse) {
    if (!apiResponse) return "";
    if (typeof apiResponse === "string") return apiResponse;
    if (typeof apiResponse.text === "string") return apiResponse.text;
    if (typeof apiResponse.story === "string") return apiResponse.story;

    try {
      if (
        apiResponse.choices &&
        apiResponse.choices[0] &&
        apiResponse.choices[0].message &&
        typeof apiResponse.choices[0].message.content === "string"
      ) {
        return apiResponse.choices[0].message.content;
      }
    } catch (e) {
      // ignorera
    }

    return JSON.stringify(apiResponse);
  }

  // ------------------------------------------------------------
  // API-anrop
  // ------------------------------------------------------------
  async function callApi(apiUrl, payload) {
    const r = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });

    let raw;
    try {
      raw = await r.json();
    } catch (e) {
      raw = await r.text();
    }
    return raw;
  }

  // ------------------------------------------------------------
  // HUVUD: GENERATE CHAPTER
  // ------------------------------------------------------------
  async function generateChapter(opts) {
    const {
      apiUrl = "/api/generate_story",
      worldState,
      storyState = {},
      chapterIndex = 1
    } = opts || {};

    if (!worldState) {
      throw new Error("BNStoryEngine: worldState saknas.");
    }

    const meta = worldState.meta || {};
    const ageBand = pickAgeBand(meta);
    const lengthPreset = resolveLengthPreset(meta, ageBand.id);

    const prompt = buildPrompt({
      worldState,
      storyState,
      chapterIndex,
      ageBand,
      lengthPreset
    });

    const payload = {
      prompt,
      age: meta.ageValue || meta.age || "",
      hero: meta.hero || "",
      length: meta.lengthValue || meta.length || "",
      lang: "sv",
      engineVersion: ENGINE_VERSION,
      worldState,
      storyState,
      chapterIndex
    };

    const apiRaw = await callApi(apiUrl, payload);
    const modelText = extractModelText(apiRaw);

    let chapterText = modelText || "";

    // Trimma mot maxChars + hel mening
    chapterText = trimToWholeSentence(
      chapterText.slice(0, ageBand.maxChars)
    );

    // I denna version låter vi storyState vara oförändrat tills vi ev.
    // bygger in en egen sammanfattningsmotor.
    return {
      chapterText,
      storyState: storyState || {},
      engineVersion: ENGINE_VERSION,
      ageBand: ageBand
    };
  }

  // ------------------------------------------------------------
  // Exportera globalt
  // ------------------------------------------------------------
  global.BNStoryEngine = {
    generateChapter,
    ENGINE_VERSION
  };
})(window);
