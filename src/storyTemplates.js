// Exempelutdrag: uppdaterad 11-12 års mall
module.exports = {
  // ... andra mallar ovan ...
  "11-12": {
    words: [640, 750], // mål ≈ 700 ord, kan vara längre
    prompt: `
Skriv en berättelse på svenska för barn 11–12 år.
Målord: 640–750 ord (mål ≈700). Max length: 750 words.
Ton: spännande, äventyrlig och lite mörkare än för yngre grupper men utan grafiskt våld.
Handling: ge tydliga mål för huvudkaraktären, konkreta hinder och stegvis eskalation.
Action: tillåt strider eller tekniska konflikter (t.ex. laser‑svärd, rymdkanoner, hackning av skepp) men beskriv rörelse, ljud, ljus och konsekvenser — INTE blod eller grafiska skador.
Karaktärsutveckling: visa hur handlingarna påverkar karaktärerna och ge ett pris eller konsekvens för vinsten.
Slut: undvik platt moralisk försoning eller "vänskap löser allt". Avsluta med ett trovärdigt, förtjänat slut eller en öppen cliffhanger som antyder möjlig fortsättning.
Språk: använd varierad rytm, korta meningar i actionscener och mer reflekterande meningar i eftertankesekvenser.
Exempel på språk: beskriv ljusskenet från ett laser‑slag, den mekaniska smaken av en rymdstation, doften av ozon efter ett energiskott.
Avsluta med eventuella bild‑prompter (Image1:, Image2:) om relevant.
`.trim()
  },
  // ... fortsättning ...
}
