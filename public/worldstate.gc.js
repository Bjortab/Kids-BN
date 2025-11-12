// public/worldstate.gc.js
// === GC v1.0 — BN-Kids World State (frontend) ===
// Lagrar världen i localStorage så sagor kan fortsätta med kausalitet.

const WS_KEY = 'bn.world.v1';

const DEFAULT_WS = {
  protagonists: [],       // ["Frans", "Vimnen"]
  location: "",           // "Grönskogen", "det gamla tornet"
  timeOfDay: "",          // "morgon", "kväll"
  goal: "",               // hjältemål: "rädda vännen", "finna boken"
  constraints: {          // hårda regler för världen
    noSuddenPowers: true,
    consistentNames: true,
    groundedPhysics: true,
    noGenericMoralEnd: true
  },
  recap: ""               // kort recap från senaste kapitlet
};

export function getWorldState() {
  try {
    const raw = localStorage.getItem(WS_KEY);
    return raw ? { ...DEFAULT_WS, ...JSON.parse(raw) } : { ...DEFAULT_WS };
  } catch {
    return { ...DEFAULT_WS };
  }
}

export function setWorldState(ws) {
  try { localStorage.setItem(WS_KEY, JSON.stringify(ws)); } catch {}
}

export function updateWorldState(patch = {}) {
  const current = getWorldState();
  const next = structuredClone(current);
  // enkel merge (1 nivå räcker här)
  for (const k of Object.keys(patch)) {
    if (typeof patch[k] === 'object' && patch[k] !== null && !Array.isArray(patch[k])) {
      next[k] = { ...(current[k] || {}), ...patch[k] };
    } else {
      next[k] = patch[k];
    }
  }
  setWorldState(next);
  return next;
}

export function resetWorldState() {
  setWorldState({ ...DEFAULT_WS });
  return getWorldState();
}

// KORT sammanfattning att skicka till modellen (billigt + styrande)
export function summarizeWorldState(ws = getWorldState()) {
  const names = (ws.protagonists || []).join(", ") || "okänd hjälte";
  const loc = ws.location || "okänd plats";
  const tod = ws.timeOfDay || "okänd tid";
  const goal = ws.goal || "okänt mål";
  const recap = ws.recap || "Ingen tidigare recap.";
  return `Hjälte(r): ${names}. Plats: ${loc}. Tid: ${tod}. Mål: ${goal}. Senast: ${recap}. Regler: inga plötsliga nya krafter, konsekvent namngivning, fysik ska hålla (magin får regler), undvik generiska moralslut.`;
}
