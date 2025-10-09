// /functions/generate_story.js
// Pages Function (Cloudflare) — POST /api/generate_story
// Body: { prompt, childName, ageBand, hero?, want_tts?: boolean }
// Reply: { story_html, audio_url? }  (audio_url är data:audio/mpeg;base64,... om TTS används)

export async function onRequestPost({ request, env }) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  try {
    const body = await request.json();
    const {
      prompt = "",
      childName = "",
      ageBand = "3-4",
      hero = null,
      want_tts = true,
    } = body || {};

    // --- serverside åldersguide (samma logik som i frontend, men här skyddar vi oss) ---
    const AGE_GUIDE = {
      "1-2": { mins: [1, 3], words: [80, 220],  maxSentenceWords: 8,  paragraphs: [3, 5],  tone: "mycket enkel, trygg, med rim/ljud, mycket upprepning" },
      "3-4": { mins: [3, 5], words: [160, 300], maxSentenceWords: 12, paragraphs: [4, 6],  tone: "enkel, tydlig början och slut, frågor och humor" },
      "5-6": { mins: [5, 10], words: [240, 450], maxSentenceWords: 16, paragraphs: [5, 7],  tone: "lite mer komplex, ett litet problem som löses, små fantasiinslag" },
      "7-8": { mins: [10, 15], words: [400, 650], maxSentenceWords: 18, paragraphs: [6, 8],  tone: "äventyr/mysterium, humor, känsla av serie" },
      "9-10": { mins: [15, 20], words: [550, 900], maxSentenceWords: 22, paragraphs: [7, 9],  tone: "fantasy/vänskap/moralfråga i lätt form" },
      "11-12": { mins: [20, 30], words: [700, 1200], maxSentenceWords: 24, paragraphs: [8, 10], tone: "lite djupare tema, men trygg och hoppfull" },
    };
    const G = AGE_GUIDE[ageBand] || AGE_GUIDE["3-4"];
    const wordsTarget = `${G.words[0]}–${G.words[1]}`;

    // --- system + user prompt ---
    const systemPrompt = [
      "Du är en varm och trygg barnboksförfattare som skriver på svenska.",
      "Regler:",
      `- Anpassa språket till åldersspannet ${ageBand}.`,
      `- Målord totalt: ${wordsTarget}.`,
      `- Max ${G.maxSentenceWords} ord per mening.`,
      `- Antal stycken: ${G.paragraphs[0]}–${G.paragraphs[1]}.`,
      "- Inget våld, skräck, hot eller mörka teman. Ingen personlig data.",
      "- Skriv i enkel **markdown**: Titel på första raden i **fetstil**, därefter stycken separerade av tomrad.",
      `- Ton: ${G.tone}.`,
      "- Avsluta med en vänlig, hoppfull känsla. Ingen cliffhanger.",
    ].join("\n");

    const heroLine = hero
      ? `Hjälte att inkludera: ${hero.name}. Kort beskrivning: ${hero.description || hero.name}.`
      : "Ingen specifik hjälte vald — skapa gärna en trevlig figur om det passar.";

    const userPrompt = [
      `Barnets namn: ${childName || "Barnet"}.`,
      `Sagognista: ${prompt || "en snäll liten saga"}.`,
      heroLine,
      "Skriv sagan nu, i enlighet med reglerna.",
    ].join("\n");

    // --- OpenAI Chat Completions ---
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.8,
      }),
    });

    if (!openaiRes.ok) {
      const errTxt = await openaiRes.text();
      throw new Error(`OpenAI error ${openaiRes.status}: ${errTxt}`);
    }
    const openaiJson = await openaiRes.json();
    const storyMarkdown =
      openaiJson?.choices?.[0]?.message?.content?.trim() || "*(ingen text)*";

    // --- Enkel markdown → HTML ---
    const story_html = mdToHtml(storyMarkdown);

    let audio_url = null;
    if (want_tts) {
      // ElevenLabs TTS → mp3 → data URL
      const voiceId = env.DEFAULT_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // fallback
      const ttsRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": env.ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
          },
          body: JSON.stringify({
            text: stripMd(storyMarkdown), // TTS läser ren text
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.8,
              style: 0.3,
            },
          }),
        }
      );

      if (!ttsRes.ok) {
        const t = await ttsRes.text();
        // Vi skickar ändå sagan tillbaka även om TTS fallerar
        console.warn("ElevenLabs TTS fail:", t);
      } else {
        const buf = await ttsRes.arrayBuffer();
        const b64 = arrayBufferToBase64(buf);
        audio_url = `data:audio/mpeg;base64,${b64}`;
      }
    }

    return new Response(
      JSON.stringify({ story_html, audio_url }),
      { status: 200, headers: { "Content-Type": "application/json", ...cors } }
    );

  } catch (err) {
    console.error("generate_story error:", err);
    return new Response(
      JSON.stringify({ error: String(err?.message || err) }),
      { status: 500, headers: { "Content-Type": "application/json", ...cors } }
    );
  }
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

// ---------- helpers ----------

function mdToHtml(md) {
  // minimalistisk renderer för vårt format
  const lines = md.trim().split(/\r?\n/);
  let html = "";
  let first = true;
  let para = [];

  const flush = () => {
    if (!para.length) return;
    html += `<p>${escapeHtml(para.join(" "))}</p>\n`;
    para = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }

    if (first && /^\*\*(.+?)\*\*$/.test(line)) {
      const title = line.replace(/^\*\*(.+?)\*\*$/, "$1");
      html += `<h3>${escapeHtml(title)}</h3>\n`;
      first = false;
      continue;
    }
    first = false;
    para.push(line);
  }
  flush();
  return html || `<p>${escapeHtml(md)}</p>`;
}

function stripMd(md) {
  // Ta bort ** ** och liknande för TTS
  return md.replace(/\*\*(.*?)\*\*/g, "$1");
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  // Cloudflare Workers har btoa
  return btoa(binary);
}
