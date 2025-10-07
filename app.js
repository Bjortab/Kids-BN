// ------- konfig -------
const ORIGIN = location.origin; // https://kids-bn.pages.dev
// ----------------------

const el = (id) => document.getElementById(id);
const state = { story: "", audioId: null, lastHero: null };

el("generateBtn").addEventListener("click", onGenerate);
el("ttsBtn").addEventListener("click", onTTS);
el("saveHeroBtn").addEventListener("click", onSaveHero);
el("plusBtn").addEventListener("click", () => startCheckout("sub"));
el("tokensBtn").addEventListener("click", () => startCheckout("one"));
el("loginBtn").addEventListener("click", () => alert("Login kommer strax – du kan testa utan konto nu."));

async function onGenerate() {
  const name = el("kidName").value.trim() || "Vännen";
  const age = el("kidAge").value;
  const prompt = el("prompt").value.trim();
  if (!prompt) return toast("Skriv först vad sagan ska handla om ✍️");

  lockUI(true, "Skapar sagan...");

  try {
    // POST /generate  { prompt, kidName, age }
    const res = await fetch(`${ORIGIN}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, kidName: name, ageGroup: age })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Kunde inte skapa saga");
    state.story = data.story || data.text || "";
    state.lastHero = data.hero || null;

    el("storyBox").textContent = state.story;
    el("storyBox").classList.remove("hidden");
    el("ttsBtn").disabled = !state.story;
    el("saveHeroBtn").disabled = !state.lastHero;
    toast("Sagan är klar! 🎉");
  } catch (e) {
    console.error(e);
    toast(e.message || "Tekniskt fel");
  } finally {
    lockUI(false);
  }
}

async function onTTS() {
  if (!state.story) return;
  lockUI(true, "Skapar ljud...");

  try {
    // POST /tts  { text, voice? }  – din Worker lagrar i R2 och returnerar {id}
    const res = await fetch(`${ORIGIN}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: state.story })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Kunde inte skapa ljud");
    state.audioId = data.id;

    // GET /tts?id=...  – streama tillbaka mp3
    const url = `${ORIGIN}/tts?id=${encodeURIComponent(state.audioId)}`;
    const a = el("player");
    a.src = url;
    a.classList.remove("hidden");
    a.play().catch(() => {});
    toast("Ljud klart! 🎧");
  } catch (e) {
    console.error(e);
    toast(e.message || "Tekniskt fel");
  } finally {
    lockUI(false);
  }
}

async function onSaveHero() {
  if (!state.lastHero) return;
  lockUI(true, "Sparar hjälte...");

  try {
    // enkel demo: spara lokalt – din riktiga backend har redan endpoint via Supabase
    const heroes = JSON.parse(localStorage.getItem("kidsbn_heroes") || "[]");
    if (heroes.length >= 10) {
      toast("Max 10 hjältar på Plus-planen.");
      return;
    }
    heroes.push(state.lastHero);
    localStorage.setItem("kidsbn_heroes", JSON.stringify(heroes));
    renderHeroes();
    toast("Hjälten sparad! 💾");
  } catch (e) {
    console.error(e);
    toast("Kunde inte spara hjälten.");
  } finally {
    lockUI(false);
  }
}

function renderHeroes() {
  const box = el("heroes");
  const heroes = JSON.parse(localStorage.getItem("kidsbn_heroes") || "[]");
  if (!heroes.length) { box.innerHTML = "<span style='color:#a8b3d6'>Inga sparade hjältar ännu.</span>"; return; }
  box.innerHTML = "";
  heroes.forEach((h, i) => {
    const div = document.createElement("div");
    div.className = "hero";
    div.innerHTML = `<strong>${escapeHTML(h.name || "Hjälte")}</strong><br><small>${escapeHTML(h.tagline || "")}</small>`;
    box.appendChild(div);
  });
}

async function startCheckout(mode) {
  try {
    const res = await fetch(`${ORIGIN}/billing_checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode })
    });
    const data = await res.json();
    if (!res.ok || !data?.url) throw new Error("Stripe checkout kunde inte startas.");
    location.href = data.url; // redirect till Stripe Checkout
  } catch (e) {
    console.error(e);
    toast(e.message || "Tekniskt fel vid betalning.");
  }
}

function lockUI(locked, label) {
  el("generateBtn").disabled = locked;
  el("ttsBtn").disabled = locked || !state.story;
  el("saveHeroBtn").disabled = locked || !state.lastHero;

  const p = el("progress");
  const t = el("progressText");
  if (locked) {
    p.classList.remove("hidden");
    t.textContent = label || "Arbetar...";
  } else {
    p.classList.add("hidden");
  }
}

function toast(msg) {
  console.log(msg);
  el("progressText").textContent = msg;
}

function escapeHTML(s){return s?.replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]))}

// init
renderHeroes();
