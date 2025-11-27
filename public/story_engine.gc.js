// ==========================================================================
// BN-KIDS — STORY ENGINE (GC v10.10)
// Frontend-shim mot backend /api/generate
// - Läser worldState-meta (ålder, längd, hjälte, kapitelIndex, previousChapters)
// - Bygger en stark, kontinuitets-säker prompt med:
//    * anti-floskel-regler
//    * kapitelroller (start/mitt/slut)
//    * miljövariation (inte alltid koja/ek/skog)
// - Anropar Cloudflare Pages Function /api/generate
// - Returnerar ren text till ws_button.gc.js
//
// Viktigt:
//  - Backend functions/generate.js (GC v6) är LÅST och oförändrad.
//  - Vi ändrar INTE API-formatet mot backend, bara innehållet i "prompt".
//  - Publikt API är oförändrat: BNStoryEngine.generateChapter(opts)
// ==========================================================================

(function (global) {
  "use strict";

  const ENGINE_VERSION = "bn-story-engine-gc-v10.10";
  const log = (...a) => console.log("[STORY GC]", ...a);

  // ------------------------------------------------------------
  // LÅGNIVÅ: API-anrop
  // ------------------------------------------------------------

  async function callApi(apiUrl, payload) {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

  function extractPromptsFromWorldState(ws) {
    if (!ws) {
      return { childPrompt: "", basePrompt: "" };
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

    // ev framtida location-tracking
    const locationsUsed = safeArray(meta.locationsUsed);

    return {
      heroName,
      ageGroupRaw,
      lengthPreset,
      storyMode,
      totalChapters,
      bookTitle,
      locationsUsed
    };
  }

  function deriveNumericAge(ageGroupRaw) {
    if (typeof ageGroupRaw === "number") return ageGroupRaw;
    if (!ageGroupRaw || typeof ageGroupRaw !== "string") return 8;
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
   * Skanna tidigare kapitel efter återkommande klyschor/miljöer.
   * Vi använder detta bara för att formulera "använd inte X igen".
   */
  function analyseCliches(previousChapters) {
    const chapters = safeArray(previousChapters);
    const all = chapters.join("\n").toLowerCase();

    return {
      hasKoja: all.includes("koja"),
      hasStorEk:
        all.includes("stora eken") ||
        all.includes("stor ek"),
      hasSolDag:
        all.includes("solig dag") ||
        all.includes("solig eftermiddag") ||
        all.includes("solig morgon"),
      hasFaglar:
        all.includes("fåglarna kvittrade") ||
        all.includes("fåglar kvittrade"),
      hasMorkSkugga:
        all.includes("mörk skugga") ||
        all.includes("skugga som rörde sig"),
      hasLillaByn:
        all.includes("lilla byn") ||
        all.includes("liten by"),
      hasVindenLekte:
        all.includes("vinden lekte") ||
        all.includes("vinden svepte genom grenarna"),
      hasOscarLåg:
        all.includes("oscar låg") ||
        all.includes("björn låg")
    };
  }

  /**
   * Bygger minnesblock (kap 1 + senaste kapitel).
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
      memoryText += "--- Senaste kapitel (måste följas) ---\n";
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
        "- Kapitel 1 ska börja i barnets vardag och sedan föra in det magiska (t.ex. den stora trollkarlen, en magisk bok eller ett konstigt föremål).",
        "- Detta vardagsstart-scenario får ALDRIG upprepas i senare kapitel."
      );
    } else {
      rules.push(
        "- Du skriver KAPITEL " + chapterIndex + ".",
        "- Du ska knyta an till slutet på förra kapitlet med 1–3 meningar, så att läsaren känner igen situationen.",
        "- Därefter får tiden gärna gå framåt (en stund senare, senare samma dag eller nästa dag).",
        "- Du får INTE nollställa historien: ingen ny barndomsstart, ingen ny \"solig dag\" i byn, ingen ny första presentation av huvudpersonerna.",
        "- Du får INTE presentera stora magiska saker (trollkarlen, den magiska platsen, boken) som om de vore nya om de redan funnits.",
        "- Du får INTE skriva om samma scen med andra ord; storyn ska röra sig framåt."
      );

      if (memory && memory.lastChapter) {
        rules.push(
          "- Läs slutet på senaste kapitlet noga och fortsätt logiskt därifrån, men låt handlingen ta nästa steg (ny plats, nytt problem eller ny insikt)."
        );
      }
    }

    return rules;
  }

  function buildPromptHandlingRules(childPrompt, basePrompt, storyMode) {
    const rules = [];

    const coreIdea =
      basePrompt && basePrompt.length > 0
        ? basePrompt
        : childPrompt;

    if (coreIdea) {
      rules.push(
        '- Hela boken kretsar kring barnets idé: "' +
          coreIdea +
          '". Varje kapitel ska föra den idén framåt (inte byta tema).'
      );
    }

    rules.push(
      "- Barnets senaste önskan/prompt ska alltid vävas in i den pågående berättelsen, inte starta en helt ny bok.",
      "- Om barnet t.ex. skriver \"Björn och Oscar blir lärjungar hos den stora trollkarlen Morris\" ska varje kapitel fortsätta det lärlingsäventyret, med nya steg i deras relation till trollkarlen och nya magiska utmaningar.",
      "- Du får inte teleportera huvudpersonerna till en helt ny, slumpmässig berättelse som inte har med grundidén att göra."
    );

    if (childPrompt && childPrompt.trim().length > 0) {
      rules.push(
        '- I det här kapitlet ska du särskilt väva in följande barnprompt (utan att starta om sagan): "' +
          childPrompt.trim() +
          '".'
      );
    }

    if (storyMode) {
      rules.push(
        '- Anpassa kapitlet till läget: "' +
          storyMode +
          '" (t.ex. kapitelbok för barn).'
      );
    }

    return rules;
  }

  function buildStyleRules(ageRules, chapterIndex, totalChapters) {
    const rules = [];

    rules.push(
      "- Skriv på enkel, levande svenska anpassad för " + ageRules.label + ".",
      "- Undvik floskler och tomma fraser. Skriv konkret vad som händer, vad barnen tänker och vad de ser.",
      "- Börja inte kapitlet med väderrapport eller naturbeskrivning. Gå direkt in i en handling, tanke eller replik.",
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
        " enkla gåtor. Ha inte med nya gåtor i varje kapitel om det inte är väldigt motiverat."
    );

    if (typeof totalChapters === "number" && totalChapters > 0) {
      if (chapterIndex === totalChapters) {
        rules.push(
          "- Detta är det SISTA kapitlet i boken. Du ska GE EN KÄNSLA AV AVSLUT.",
          "- Skriv INTE fraser i stil med \"detta var bara början\" eller lova en fortsättning.",
          "- Knyt ihop huvudäventyret på ett tryggt sätt."
        );
      } else {
        rules.push(
          "- Avsluta kapitlet med en mild krok (cliffhanger) som gör barnet nyfiket på nästa kapitel, utan att bli för läskigt."
        );
      }
    } else if (chapterIndex >= 3) {
      rules.push(
        "- I senare kapitel kan du ibland knyta ihop ett deläventyr på ett tryggt sätt, istället för att alltid öppna nya trådar."
      );
    }

    return rules;
  }

  /**
   * Anti-floskel-/anti-klyscha-regler, inkl. miljöstyrning.
   */
  function buildAntiClicheRules(clicheScan) {
    const rules = [
      "=== ANTI-FLOSKEL-REGLER ===",
      "- Använd INTE standardformuleringar som:",
      '  * \"Det var en solig dag\" / \"Det var en solig morgon\" / \"Det var en solig eftermiddag\"',
      '  * \"Fåglarna kvittrade\"',
      '  * \"Vinden lekte i grenarna\" eller liknande',
      '  * \"De var modiga\" som enda beskrivning av känslor',
      '  * \"De vände sig om och såg en mörk skugga\"',
      '  * \"den lilla byn\" som upprepas om och om igen',
      "- Beskriv istället något mer konkret och unikt med just den här platsen, den här dagen och de här barnen."
    ];

    if (clicheScan.hasKoja) {
      rules.push(
        "- Kojor har redan förekommit i tidigare kapitel. I detta kapitel ska du INTE använda kojan som huvudmiljö, om inte barnet uttryckligen ber om det."
      );
    }

    if (clicheScan.hasStorEk) {
      rules.push(
        "- Den stora eken har redan varit med. Välj en annan tydlig plats istället för att börja om vid samma träd."
      );
    }

    if (clicheScan.hasSolDag) {
      rules.push(
        "- Undvik att börja med en ny \"solig dag\". Om väder nämns ska det vara kort och inte upprepas från tidigare kapitel."
      );
    }

    if (clicheScan.hasFaglar) {
      rules.push(
        "- Undvik frasen \"fåglarna kvittrade\". Om ljud ska beskrivas, hitta något mer specifikt och varierat."
      );
    }

    if (clicheScan.hasMorkSkugga) {
      rules.push(
        "- Undvik \"mörk skugga\" som standardspänning. Hitta en annan typ av spänning som passar barnets ålder."
      );
    }

    if (clicheScan.hasLillaByn) {
      rules.push(
        "- Om byn nämns igen, ge den nya detaljer istället för att bara kalla den \"den lilla byn\" varje gång."
      );
    }

    if (clicheScan.hasOscarLåg || clicheScan.hasVindenLekte) {
      rules.push(
        "- Börja inte kapitlet med att någon ligger och tittar upp i grenverket eller med en vindbeskrivning. Gå istället direkt in i en handling, tanke eller dialog."
      );
    }

    return rules;
  }

  /**
   * Kapitel-roll: vad ska kapitel 1, 2, mitten, sista göra?
   */
  function buildChapterArcRules(chapterIndex, totalChapters, basePrompt, childPrompt) {
    const rules = [];
    const idea = basePrompt || childPrompt || "";

    rules.push("=== KAPITELROLL ===");

    if (!totalChapters || totalChapters <= 1) {
      // Okänd längd → generella råd
      if (chapterIndex === 1) {
        rules.push(
          "- Kapitel 1: etablera vardagen, huvudpersonerna och kroken in i äventyret. Sätt igång huvudspåret i barnets idé."
        );
      } else {
        rules.push(
          "- Detta är ett mittkapitel. För handlingen framåt med nya steg i samma äventyr, istället för att upprepa början."
        );
      }
      return rules;
    }

    if (chapterIndex === 1) {
      rules.push(
        "- Kapitel 1 ska etablera vardagen, huvudpersonerna, platsen och den första kontakten med det magiska (t.ex. trollkarlen, boken, portalen).",
        "- Lägg en tydlig krok som gör att barnen vill fortsätta läsa nästa kapitel."
      );
    } else if (chapterIndex === 2 && totalChapters >= 3) {
      rules.push(
        "- Kapitel 2 ska ta huvudpersonerna UT ur startmiljön och in i första riktiga steget i äventyret.",
        "- Visa att deras beslut i kapitel 1 får konsekvenser. De rör sig mot målet i barnets idé."
      );
    } else if (chapterIndex < totalChapters) {
      rules.push(
        "- Detta är ett mittkapitel. Håll fokus på samma huvudmål. Introducera ett hinder, en ledtråd eller en ny plats som för dem närmare lösningen.",
        "- Undvik att fastna i samma miljö eller upprepa samma typ av dilemma som redan hänt."
      );
    }

    if (chapterIndex === totalChapters) {
      rules.push(
        "- Detta är sista kapitlet. Låt huvudpersonerna lyckas eller förlora på ett tydligt och tryggt sätt.",
        "- Koppla direkt till barnets ursprungliga idé: \""
          + idea +
          "\" (om den finns). Visa hur just den idén får sitt svar eller sin upplösning.",
        "- Ge en känsla av att äventyret har fått ett slut, även om barnen skulle kunna hitta på fler äventyr senare."
      );
    }

    return rules;
  }

  /**
   * Bygg prompten som skickas som "prompt" till backend.
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
    const clicheScan = analyseCliches(previousChapters);

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
      "Du skriver nu ett ENDA kapitel i en pågående bok. Detta kapitel ska hålla hårt i kontinuiteten men ändå föra handlingen tydligt framåt.",
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
      basePrompt,
      storyMode
    );
    const styleRules = buildStyleRules(
      ageRules,
      chapterIndex,
      totalChapters
    );
    const antiClicheRules = buildAntiClicheRules(clicheScan);
    const chapterArcRules = buildChapterArcRules(
      chapterIndex,
      totalChapters,
      basePrompt,
      childPrompt
    );

    const rulesSection =
      "=== REGLER FÖR DETTA KAPITEL ===\n" +
      continuityRules
        .concat(promptHandlingRules, styleRules)
        .join("\n") +
      "\n\n" +
      antiClicheRules.join("\n") +
      "\n\n" +
      chapterArcRules.join("\n") +
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
      "- Knyt an till slutet av förra kapitlet med några få meningar och låt sedan handlingen ta ett TYDLIGT nästa steg.",
      "- Använd en ny eller tydligt utvecklad miljö om tidigare kapitel redan använt t.ex. koja, stor ek, standard-skog. Undvik att återvända till exakt samma startläge.",
      "- Väv in barnets idé och senaste önskan i det som händer i kapitlet, utan att starta om berättelsen.",
      "- Håll texten till ungefär 400–700 ord för 7–8 år; något längre är okej för äldre barn.",
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

    const strongPrompt = buildStoryPromptFromWorldState(
      ws,
      chapterIndex,
      storyMode
    );

    const payload = {
      // Samma nycklar som tidigare:
      prompt: strongPrompt,
      heroName,
      ageGroup: ageGroupRaw,
      lengthPreset,
      storyMode,
      chapterIndex,
      worldState: ws,
      totalChapters,
      // Extra info som backend kan ignorera:
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

  log("story_engine.gc.js laddad (GC v10.10)");

})(window);
