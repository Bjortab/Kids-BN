// ==========================================================================
// BN-KIDS — STORY ENGINE (GC v10.9)
// Frontend-shim mot backend /api/generate
// - Läser worldState-meta (ålder, längd, hjälte, kapitelIndex, previousChapters)
// - Bygger en stark, kontinuitets-säker prompt (ingen "ny lördag" i varje kapitel)
// - Anropar Cloudflare Pages Function /api/generate
// - Returnerar ren text till ws_button.gc.js
//
// Viktigt:
//  - Backend functions/generate.js (GC v6) är LÅST och är kvar som "hjärna".
//  - Vi ändrar INTE API-formatet mot backend, bara innehållet i "prompt".
//  - Denna fil är nu lite smartare men har samma publika API som tidigare.
// ==========================================================================

(function (global) {
  "use strict";

  const ENGINE_VERSION = "bn-story-engine-gc-v10.9";

  const log = (...a) => console.log("[STORY GC]", ...a);

  // ------------------------------------------------------------
  // LÅGNIVÅ: API-anrop
  // ------------------------------------------------------------

  async function callApi(apiUrl, payload) {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    let data;
    try {
      data = await res.json();
    } catch (err) {
      console.error("[STORY GC] Kunde inte parsa JSON:", err);
      throw new Error("Kunde inte läsa svar från API:t.");
    }

    if (!res.ok || !data || data.ok === false) {
      const msg =
        (data && (data.error || data.message)) ||
        `API-svar med status ${res.status}`;
      throw new Error(msg);
    }

    return data;
  }

  // ------------------------------------------------------------
  // HJÄLPARE: META & STATE
  // ------------------------------------------------------------

  function safeArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === "string") return [value];
    return [];
  }

  /**
   * Plocka fram "barnets prompt" ur worldState.
   * - _userPrompt / last_prompt = senaste önskan
   * - meta.originalPrompt = ursprunglig idé (om den finns)
   */
  function extractPromptsFromWorldState(ws) {
    if (!ws) {
      return {
        childPrompt: "",
        basePrompt: ""
      };
    }

    const meta = ws.meta || {};

    const childPrompt =
      ws._userPrompt ||
      ws.last_prompt ||
      meta.lastChildPrompt ||
      "";

    const basePrompt =
      meta.originalPrompt ||
      meta.basePrompt ||
      ws._initialPrompt ||
      childPrompt ||
      "";

    return {
      childPrompt: String(childPrompt || "").trim(),
      basePrompt: String(basePrompt || "").trim()
    };
  }

  function extractMeta(ws) {
    const meta = (ws && ws.meta) || {};

    const heroName = meta.hero || "hjälten";

    const ageGroupRaw =
      meta.ageValue || meta.age || meta.ageLabel || "7-8 år";

    const lengthPreset =
      meta.lengthValue || meta.length || meta.lengthLabel || "medium";

    const storyMode = ws.story_mode || "chapter_book";

    const totalChapters = Number(meta.totalChapters || 8);

    const bookTitle =
      meta.bookTitle ||
      meta.title ||
      meta.storyTitle ||
      "";

    return {
      heroName,
      ageGroupRaw,
      lengthPreset,
      storyMode,
      totalChapters,
      bookTitle
    };
  }

  /**
   * Försök härleda en numerisk ålder från ageGroupRaw, t.ex. "7-8 år".
   */
  function deriveNumericAge(ageGroupRaw) {
    if (typeof ageGroupRaw === "number") return ageGroupRaw;

    if (!ageGroupRaw || typeof ageGroupRaw !== "string") {
      return 8;
    }

    const match = ageGroupRaw.match(/(\d+)/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (!isNaN(n)) return n;
    }

    return 8;
  }

  function normalizeAgeSegment(age) {
    if (typeof age !== "number") return "7-8";
    if (age <= 8) return "7-8";
    if (age <= 10) return "9-10";
    return "10-12";
  }

  function getAgeRules(age) {
    const segment = normalizeAgeSegment(age);

    if (segment === "7-8") {
      return {
        label: "7–8 år",
        maxRiddlesPerBook: 2,
        sentenceLength: "kort till medellång",
        tone: "trygg, enkel, varm, lite busig",
        complexity: "enkla meningar, inga krångliga ord",
        allowedScary: "lätt pirr, men aldrig riktig skräck"
      };
    }

    if (segment === "9-10") {
      return {
        label: "9–10 år",
        maxRiddlesPerBook: 3,
        sentenceLength: "medellång",
        tone: "äventyrlig, nyfiken, men fortfarande trygg",
        complexity: "lite mer avancerade meningar",
        allowedScary: "lite mer spänning men inget otäckt på riktigt"
      };
    }

    return {
      label: "10–12 år",
      maxRiddlesPerBook: 4,
      sentenceLength: "medellång till lite längre",
      tone: "äventyrlig, smart, nyfiken",
      complexity: "mer avancerade meningar är okej",
      allowedScary: "spänning är okej men inget grovt eller traumatiskt"
    };
  }

  /**
   * Bygg ett "minnesblock" från tidigare kapitel:
   *  - Kapitel 1 (start)
   *  - Senaste kapitel (måste följas)
   */
  function buildMemoryBlock(previousChapters) {
    const chapters = safeArray(previousChapters);
    if (!chapters.length) {
      return {
        hasMemory: false,
        text: "",
        lastChapter: "",
        firstChapter: ""
      };
    }

    const firstChapter = chapters[0] || "";
    const lastChapter = chapters[chapters.length - 1] || "";

    let memoryText = "";

    if (firstChapter) {
      memoryText += "--- Sammanhang från kapitel 1 (starten) ---\n";
      memoryText += firstChapter.trim() + "\n\n";
    }

    if (lastChapter && lastChapter !== firstChapter) {
      memoryText += "--- Senaste kapitel (måste följas exakt) ---\n";
      memoryText += lastChapter.trim() + "\n\n";
    }

    return {
      hasMemory: true,
      text: memoryText,
      lastChapter,
      firstChapter
    };
  }

  function buildContinuityRules(chapterIndex, memory) {
    const rules = [];

    if (chapterIndex <= 1) {
      rules.push(
        "- Du skriver KAPITEL 1.",
        "- Kapitel 1 ska börja i barnets vardag och sedan föra in det magiska (t.ex. en magisk björk).",
        "- Detta vardagsstart-scenario får ALDRIG upprepas i senare kapitel."
      );
    } else {
      rules.push(
        "- Du skriver KAPITEL " + chapterIndex + ".",
        "- Du måste EXAKT fortsätta där senaste kapitlet slutade – samma plats, samma tidpunkt och samma personer om inget annat är tydligt motiverat.",
        "- Du får INTE börja om dagen, året eller platsen.",
        "- Du får INTE introducera en magisk plats, magiskt föremål eller nyckelhändelse som om det vore första gången om den redan funnits i tidigare kapitel.",
        "- Du får INTE upprepa fraser i stil med: \"Det var en solig lördagmorgon i den lilla byn där Björn bodde\" om det redan hänt i kapitel 1."
      );

      if (memory && memory.lastChapter) {
        rules.push(
          "- Läs noga slutet på senaste kapitlet och fortsätt scenen därifrån. Du ska känna att kameran står kvar där den stod i slutet av förra kapitlet."
        );
      }
    }

    return rules;
  }

  function buildPromptHandlingRules(childPrompt, mode) {
    const rules = [];

    rules.push(
      "- Barnets senaste önskan/prompt ska alltid vävas in i den pågående scenen, inte starta en helt ny bok.",
      "- Om barnet t.ex. skriver \"Björn förvandlar en hund så att den får vingar\" och historien redan utspelar sig vid en magisk björk, ska hunden dyka upp i samma scen och förvandlingen ske med hjälp av den redan etablerade magin.",
      "- Du får inte teleportera huvudpersonen till en helt ny plats eller ny tid utan tydlig brygga från det som hänt tidigare."
    );

    if (childPrompt && childPrompt.trim().length > 0) {
      rules.push(
        '- I det här kapitlet ska du särskilt väva in följande barnprompt i den pågående scenen (utan att starta om sagan): "' +
          childPrompt.trim() +
          '".'
      );
    }

    if (mode) {
      rules.push(
        "- Anpassa kapitlet till läget: \"" +
          mode +
          "\" (t.ex. kapitelbok), så det känns som en del av en sammanhängande bok."
      );
    }

    return rules;
  }

  function buildStyleRules(ageRules, chapterIndex, totalChapters) {
    const rules = [];

    rules.push(
      "- Skriv på enkel, levande svenska anpassad för " + ageRules.label + ".",
      "- Undvik floskler och tomma fraser (t.ex. \"det var en gång\" om det inte är helt nödvändigt).",
      "- Undvik upprepade inledningar i varje kapitel (ingen ny \"fin lördagmorgon\" om det redan är etablerat).",
      "- Använd " +
        ageRules.sentenceLength +
        " meningar och " +
        ageRules.complexity +
        ".",
      "- Tonen ska vara " + ageRules.tone + " med " + ageRules.allowedScary + "."
    );

    rules.push(
      "- Gåtor får förekomma, men sparsamt. Totalt i boken får det vara max " +
        ageRules.maxRiddlesPerBook +
        " enkla gåtor. Undvik att stoppa in gåtor i varje kapitel om det inte är väldigt motiverat."
    );

    if (typeof totalChapters === "number" && totalChapters > 0) {
      if (chapterIndex === totalChapters) {
        rules.push(
          "- Detta är det SISTA kapitlet i boken. Du ska GE EN KÄNSLA AV AVSLUT.",
          "- Skriv INTE fraser i stil med \"detta var bara början\" eller lova en fortsättning.",
          "- Se till att trådarna i äventyret knyts ihop på ett tryggt sätt för barnet."
        );
      } else {
        rules.push(
          "- Avsluta kapitlet med en mild krok (cliffhanger) som gör barnet nyfiket på nästa kapitel, utan att bli för läskigt."
        );
      }
    } else {
      if (chapterIndex >= 3) {
        rules.push(
          "- Du behöver inte alltid öppna upp för en oändlig fortsättning. I senare kapitel kan du ibland knyta ihop ett deläventyr på ett tryggt sätt."
        );
      }
    }

    return rules;
  }

  /**
   * Bygg den stora prompten som vi skickar vidare som "prompt" till backend.
   */
  function buildStoryPromptFromWorldState(ws, chapterIndex, storyMode) {
    const meta = extractMeta(ws);
    const { childPrompt, basePrompt } = extractPromptsFromWorldState(ws);

    const ageNumeric = deriveNumericAge(meta.ageGroupRaw);
    const ageRules = getAgeRules(ageNumeric);

    const previousChapters =
      ws.previousChapters ||
      ws.chapters ||
      ws._chapters ||
      [];

    const memory = buildMemoryBlock(previousChapters);

    const totalChapters =
      typeof meta.totalChapters === "number" && meta.totalChapters > 0
        ? meta.totalChapters
        : undefined;

    // Titelrad
    let titleLine = "";
    if (meta.bookTitle) {
      titleLine = 'Boktitel: "' + meta.bookTitle + '"\n';
    } else if (basePrompt) {
      titleLine =
        'Bok baserad på barnets idé (kort beskrivet): "' +
        basePrompt +
        '"\n';
    } else {
      titleLine = "Bok utan angiven titel, huvudperson: barnet.\n";
    }

    const intro = [
      "Du är en professionell barnboksförfattare och fungerar som en \"story engine\" i ett system som skriver kapitelböcker för barn.",
      "Du skriver nu ett ENDA kapitel i en pågående bok. Detta kapitel ska HÅLLA HÅRT I kontinuiteten från tidigare kapitel.",
      "Du skriver alltid på svenska.",
      "",
      titleLine.trim(),
      "",
      "Åldersgrupp: " + ageRules.label + ".",
      "Läge: " + (storyMode || "kapitelbok") + ".",
      "Detta är kapitel: " +
        chapterIndex +
        (totalChapters ? " av " + totalChapters : "") +
        "."
    ].join("\n");

    let memorySection = "";
    if (memory.hasMemory) {
      memorySection =
        "=== TIDIGARE KAPITEL – DETTA MÅSTE DU RESPEKTERA ===\n" +
        memory.text.trim() +
        "\n\n";
    } else {
      memorySection =
        "=== TIDIGARE KAPITEL ===\nInga tidigare kapitel finns (detta är början av boken).\n\n";
    }

    const continuityRules = buildContinuityRules(chapterIndex, memory);
    const promptHandlingRules = buildPromptHandlingRules(
      childPrompt,
      storyMode
    );
    const styleRules = buildStyleRules(
      ageRules,
      chapterIndex,
      totalChapters
    );

    const rulesSection =
      "=== REGLER FÖR DETTA KAPITEL ===\n" +
      continuityRules.concat(promptHandlingRules, styleRules).join("\n") +
      "\n\n";

    let childPromptSection = "";
    if (childPrompt && childPrompt.trim().length > 0) {
      childPromptSection =
        "=== BARNETS SENASTE ÖNSKAN / PROMPT ===\n" +
        childPrompt.trim() +
        "\n\n";
    } else if (basePrompt) {
      childPromptSection =
        "=== BARNETS STARTIDÉ ===\n" + basePrompt + "\n\n";
    } else {
      childPromptSection =
        "=== BARNETS IDÉ ===\nInga extra detaljer finns från barnet för just detta kapitel.\n\n";
    }

    const taskSection = [
      "=== DIN UPPGIFT ===",
      "- Skriv nästa kapitel i boken, på svenska, som riktar sig till " +
        ageRules.label +
        ".",
      "- Fortsätt exakt från slutet av det senaste kapitlet (om sådant finns).",
      "- Väv in barnets senaste önskan/prompt i den pågående scenen utan att starta om sagan.",
      "- Håll texten till ungefär 400–700 ord för 7–8 år, och något längre är okej för äldre barn.",
      "- Använd styckeindelning så texten blir luftig och lättläst.",
      "- Skriv endast själva kapitlet. Inga metakommentarer, inga rubriker som \"Kapitel " +
        chapterIndex +
        "\" i texten, och inga sammanfattningar efteråt."
    ].join("\n");

    const fullPrompt =
      intro.trim() +
      "\n\n" +
      memorySection +
      rulesSection +
      childPromptSection +
      taskSection +
      "\n";

    return fullPrompt;
  }

  // ------------------------------------------------------------
  // HUVUD: generateChapter
  // ------------------------------------------------------------

  async function generateChapter(opts) {
    const {
      apiUrl = "/api/generate",
      worldState,
      storyState = {},
      chapterIndex = 1
    } = opts || {};

    if (!worldState) {
      throw new Error("BNStoryEngine: worldState saknas.");
    }

    const ws = worldState;
    const {
      heroName,
      ageGroupRaw,
      lengthPreset,
      storyMode,
      totalChapters,
      bookTitle
    } = extractMeta(ws);

    // Bygg en stark, kontinuitets-säker prompt baserat på worldState
    const strongPrompt = buildStoryPromptFromWorldState(
      ws,
      chapterIndex,
      storyMode
    );

    const payload = {
      // OBS: vi behåller samma nycklar som tidigare
      prompt: strongPrompt,
      heroName,
      ageGroup: ageGroupRaw,
      lengthPreset,
      storyMode,
      chapterIndex,
      worldState: ws,
      totalChapters,
      // Lite extra info som backend kan ignorera om den vill
      bookTitle,
      storyEngineVersion: ENGINE_VERSION
    };

    log("Anropar backend /api/generate", {
      chapterIndex,
      storyMode,
      ageGroupRaw,
      lengthPreset
    });

    const data = await callApi(apiUrl, payload);
    const storyText = (data && data.story) || "";

    return {
      chapterText: storyText,
      storyState: storyState || {},
      engineVersion: ENGINE_VERSION
    };
  }

  // ------------------------------------------------------------
  // Exportera globalt
  // ------------------------------------------------------------

  global.BNStoryEngine = {
    generateChapter,
    ENGINE_VERSION
  };

  log("story_engine.gc.js laddad (GC v10.9)");

})(window);
