// === DEV v1.0 — World State Manager (DEV) ===
// IDENTISKT API som GC, men vi loggar för felsökning

const WORLD_STATE_KEY = "bn_world_state_v1_dev";

export function getWorldState() {
  try {
    const raw = localStorage.getItem(WORLD_STATE_KEY);
    const ws = raw ? JSON.parse(raw) : defaultWorldState();
    console.log("🧪 worldstate.get ->", ws);
    return ws;
  } catch {
    return defaultWorldState();
  }
}

export function setWorldState(ws) {
  console.log("🧪 worldstate.set <-", ws);
  localStorage.setItem(WORLD_STATE_KEY, JSON.stringify(ws));
}

export function updateWorldState(patch = {}) {
  const merged = { ...getWorldState(), ...patch };
  setWorldState(merged);
  return merged;
}

export function resetWorldState() {
  setWorldState(defaultWorldState());
  return getWorldState();
}

export function summarizeWorldState(ws = getWorldState()) {
  const parts = [];
  if (ws.place) parts.push(`plats: ${ws.place}`);
  if (ws.season) parts.push(`årstid: ${ws.season}`);
  if (ws.weather) parts.push(`väder: ${ws.weather}`);
  if (ws.characters?.length) parts.push(`karaktärer: ${ws.characters.join(", ")}`);
  if (ws.inventory?.length) parts.push(`föremål: ${ws.inventory.join(", ")}`);
  if (ws.forbidden?.length) parts.push(`förbjudet: ${ws.forbidden.join(", ")}`);
  if (ws.open_threads?.length) parts.push(`öppna trådar: ${ws.open_threads.join("; ")}`);
  const s = parts.join(" | ");
  console.log("🧪 worldstate.summary ->", s);
  return s;
}

function defaultWorldState() {
  return {
    place: "Grönskogen",
    season: "vår",
    weather: "fuktigt",
    characters: [],
    inventory: [],
    forbidden: ["magi", "eld utan orsak"],
    open_threads: []
  };
}
