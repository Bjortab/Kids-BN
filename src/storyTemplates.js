// VERSION: 1.1.0
// BUILD: 2025-11-07
// CHANGES: Added separate templates for age 1 and 2; updated 9-10 and 11-12 length targets.
// MAINTAINER: Bjortab
//
// Exports prompt templates and target word ranges used by generate_story handler.

const TEMPLATES = {
  // 1 year (very short, rhythmic, 20-40s)
  "1": {
    words: [30, 55], // target ~40
    prompt: `
Skriv en mycket kort, enkel och rytmisk barnberättelse på svenska för ett barn på 1 år.
Målord: 30-55 ord. Max length: 55 words.
Stil: enkla ord och mycket rytm; korta meningar; repetition fungerar bra.
Fokus: EN huvudkaraktär och EN liten händelse (t.ex. tappat en leksak).
Ton: trygg, varm, lugn.
Konflikt: mycket liten, lösning snabbt och tryggt (t.ex. förälder eller vän hjälper).
Slut: en lugn, trygg mening.
Inkludera efter berättelsen 2 korta bild‑prompter: Image1:..., Image2:... (en rad per prompt).
Avsluta exakt med bildraderna.
`.trim()
  },

  // 2 year (short, slightly more detail, 30-60s)
  "2": {
    words: [60, 110], // target ~80
    prompt: `
Skriv en kort och lättläst berättelse på svenska för ett barn på 2 år.
Målord: 60-110 ord. Max length: 110 words.
Stil: enkla meningar men med lite mer beskrivning än för 1 år; upprepning och konkreta bilder fungerar bra.
Fokus: EN huvudkaraktär, EN enkel utmaning (t.ex. hitta en sak, vara modig).
Ton: trygg och varm.
Konflikt: liten och löses av hjälp/framsteg.
Slut: lugnt och tryggt.
Inkludera efter berättelsen 2 bild‑prompter (Image1:, Image2:) med stil: pastell, varmt ljus.
Avsluta med bildraderna.
`.trim()
  },

  // 3-6 years (short)
  "3-6": {
    words: [90, 160],
    prompt: `
Skriv en kort berättelse på svenska för barn 3–6 år.
Målord: 90–160 ord. Max length: 160 words.
Stil: enkel men beskrivande; korta stycken. Tydlig huvudkonflikt och snäll lösning.
Slut: lugnt och positivt (kan vara försonande men inte alltid kliché).
Inkludera 3 bild‑prompter (Image1:, Image2:, Image3:) med stil: färgglad och vänlig.
Avsluta med bildraderna.
`.trim()
  },

  // 7-10 years (medellång)
  "7-10": {
    words: [200, 260],
    prompt: `
Skriv en medellång berättelse på svenska för barn 7–10 år.
Målord: 200–260 ord (mål ≈220). Max length: 260 words.
Stil: engagerande prosa, tydlig konflikt och trovärdig lösning.
Undvik platta klichéer där allt alltid försonas automatiskt.
Slut: ge realistiska konsekvenser eller en öppning för fortsättning (en ledtråd eller beslut).
Dialog: kort och funktionell.
Inkludera 3-4 bild‑prompter (Image1:... etc.) med miljö och känsla.
Avsluta med bildraderna.
`.trim()
  },

  // 9-10 years (longer — recommended 4 min ~520 words; can be set to 5min if you decide)
  "9-10": {
    words: [480, 560], // target ~520 words (≈4 min). If you want 5 min set to 650 by config change.
    prompt: `
Skriv en berättelse på svenska för barn 9–10 år.
Målord: 480–560 ord (mål ≈520). Max length: 560 words.
Ton: äventyrlig, mer utvecklad än yngre grupper.
Konflikt: tydlig utmaning med realistiska konsekvenser.
Slut: kan vara delvis öppet eller visa konsekvens — undvik alltid "fienden blir snäll" som default.
Dialog: kort, trovärdig.
Inkludera 3-4 bild‑prompter med atmosfär (Image1:, Image2:, ...).
Avsluta med bildraderna.
`.trim()
  },

  // 11-12 years (minst 5 min ~650 words)
  "11-12": {
    words: [640, 700], // target 650, max 700
    prompt: `
Skriv en berättelse på svenska för barn 11–12 år.
Målord: 640–700 ord (mål ≈650). Max length: 700 words.
Ton: mogen men barnvänlig; nyanserad och trovärdig.
Ge karaktärer med motivation och en konflikt som kräver plan, mod eller konsekvens.
Dialog: korta repliker när de behövs.
Slut: undvik platta försoningsfloskler som "och så levde de lyckliga"; ge en realistisk konsekvens eller ett öppet slut/cliffhanger som lämnar rum för fortsättning.
Inkludera 4 bild‑prompter (Image1: ... Image4:) med stil och känsla.
Avsluta exakt med bildraderna.
`.trim()
  }
};

module.exports = {
  VERSION: '1.1.0',
  TEMPLATES
};
