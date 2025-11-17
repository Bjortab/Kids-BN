// ==========================================================
// BN-KIDS — IP BLOCKLIST (v2)
// - Håller koll på upphovsrättsskyddade namn/termer
// - Exponerar:
//    - BNKidsIP.BLOCKED_IP_TERMS
//    - BNKidsIP.normalize(text)
//    - BNKidsIP.detectBlockedTerms(text)
// ==========================================================
(function (global) {
  "use strict";

  const BNKidsIP = global.BNKidsIP || {};

  // --------------------------------------------------------
  // Lista med exempel på skyddat IP.
  // Allt ligger i lowercase.
  // Du kan utöka listan när du vill.
  // --------------------------------------------------------
  BNKidsIP.BLOCKED_IP_TERMS = [
    // Svenska klassiker
    "pippi långstrump",
    "pippi",
    "emil i lönneberga",
    "emil",
    "ronja rövardotter",
    "ronja",
    "nils karlsson pyssling",
    "madicken",
    "bröderna lejonhjärta",
    "lejonhjärta",
    "astrid lindgren",

    // Globala IP-klumpar
    "harry potter",
    "hogwarts",
    "star wars",
    "jedi",
    "sith",
    "lightsaber",

    // Darth Vader + vanliga felstavningar
    "darth vader",
    "dark vader",
    "dart vader",
    "dart vador",
    "dart wader",

    "marvel",
    "avengers",
    "iron man",
    "spider-man",
    "spiderman",
    "batman",
    "superman",
    "dc comics",
    "disney",
    "frost",
    "elsa",
    "anna",
    "olaf",
    "pokemon",
    "pokémon",
    "pikachu",
    "super mario",
    "mario",
    "luigi",
    "sonic",
    "minecraft",
    "fortnite",
    "roblox",

    // LEGO + leksaker
    "lego",
    "lego-gubbar",
    "lego gubbar",

    // Generella varumärkes- / franchise-ord
    "barbie",
    "hello kitty",
    "angry birds",
    "star trek"
  ].map(function (t) {
    return (t || "").toLowerCase().trim();
  });

  // --------------------------------------------------------
  // Normalisering: lowercase, trimmat
  // --------------------------------------------------------
  BNKidsIP.normalize = function normalize(text) {
    if (!text) return "";
    return String(text).toLowerCase();
  };

  // --------------------------------------------------------
  // detectBlockedTerms(text):
  //  - returnerar en array med alla träffade IP-termer
  //    (i lowercase, utan dubbletter)
// --------------------------------------------------------
  BNKidsIP.detectBlockedTerms = function detectBlockedTerms(text) {
    const norm = BNKidsIP.normalize(text);
    if (!norm) return [];

    const hits = [];
    for (const term of BNKidsIP.BLOCKED_IP_TERMS) {
      if (!term) continue;
      if (norm.indexOf(term) !== -1) {
        hits.push(term);
      }
    }

    // Ta bort dubbletter
    return Array.from(new Set(hits));
  };

  // --------------------------------------------------------
  // Exponera globalt
  // --------------------------------------------------------
  global.BNKidsIP = BNKidsIP;
})(window);
