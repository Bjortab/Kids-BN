<!doctype html>
<html lang="sv">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>BN’s Sagovärld</title>
  <style>
    :root{
      --bg:#0f1115; --panel:#1b1f2a; --txt:#e7eef7; --muted:#9fb0c3;
      --accent:#19d17f; --warn:#ffb200; --err:#ff5d5d;
    }
    *{box-sizing:border-box}
    body{margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; background:var(--bg); color:var(--txt)}
    .wrap{max-width:980px; margin:40px auto; padding:0 16px}
    h1{color:#2fff9e; text-align:center; margin:0 0 8px}
    h2{color:var(--muted); text-align:center; margin:0 0 24px; font-weight:500}
    .panel{background:var(--panel); padding:18px; border-radius:10px; box-shadow:0 0 0 1px rgba(255,255,255,.03) inset}
    label{display:block; font-size:14px; color:var(--muted); margin:10px 0 6px}
    input[type=text], select, textarea{
      width:100%; padding:10px 12px; border-radius:8px; border:1px solid #2a3244;
      background:#12141b; color:var(--txt); outline:none;
    }
    textarea{min-height:84px; resize:vertical}
    .row{display:flex; gap:10px; flex-wrap:wrap}
    .row > div{flex:1 1 260px}
    .btns{display:flex; gap:10px; flex-wrap:wrap; margin-top:12px}
    button{
      border:0; padding:10px 14px; border-radius:8px; cursor:pointer; font-weight:600;
      background:#2a3244; color:#fff;
    }
    .btn-primary{background:var(--accent); color:#042b17}
    .btn-warn{background:var(--warn); color:#2b1a00}
    .btn-ghost{background:#232a3a}
    .status{margin-top:10px; font-size:14px; color:var(--muted)}
    .status--ok{color:var(--accent)} .status--error{color:var(--err)}
    #resultText{white-space:pre-wrap; line-height:1.6}
    #resultAudio{width:100%; margin-top:10px}
    .section{margin-top:18px}
    /* Spinner */
    #ttsSpinner{display:flex; align-items:center; gap:10px; margin-top:10px}
    .dot{width:8px; height:8px; border-radius:50%; background:var(--accent); animation:b 1s infinite alternate}
    .dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}
    @keyframes b{from{opacity:.3; transform:translateY(0)} to{opacity:1; transform:translateY(-5px)}}
    /* Cache meter */
    #cacheWrap{display:none; align-items:center; gap:10px; margin-top:8px}
    #cacheBarBox{flex:1; height:8px; background:#1a2030; border-radius:99px; overflow:hidden}
    #cacheBar{width:0%; height:100%; background:#2fff9e}
    #cacheText{font-size:12px; color:var(--muted)}
    /* Bildkort */
    #storyImages{display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; margin-top:12px}
    .story-image-card{background:#10131a; border:1px solid #2a3244; border-radius:8px; padding:6px}
    .story-image-card img{width:100%; height:auto; display:block; border-radius:6px}
    /* “Tala in” indikatorer */
    #recBadge{display:none; margin-left:8px; font-size:12px; color:#ff6969}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>BN’s Sagovärld</h1>
    <h2>…där drömmar blir berättelser</h2>

    <div class="panel">
      <div class="row">
        <div>
          <label>Barnets namn</label>
          <input id="childName" type="text" placeholder="t.ex. Lisa" />
        </div>
        <div>
          <label>Ålder</label>
          <select id="ageRange">
            <option>1–2 år</option>
            <option>3–4 år</option>
            <option>5–6 år</option>
            <option>7–8 år</option>
            <option>9–10 år</option>
            <option>11–12 år</option>
          </select>
        </div>
      </div>

      <label>Sagognista (vad ska sagan handla om?)</label>
      <textarea id="prompt" placeholder="t.ex. En liten drake som lär sig flyga."></textarea>

      <div class="row">
        <div>
          <label>
            <input id="useWhisper" type="checkbox" />
            Använd extra exakt rösttolkning (Whisper)
          </label>
        </div>
        <div>
          <label>Hjältens namn (valfritt)</label>
          <input id="heroName" type="text" placeholder="t.ex. Draki eller Prinsessan Nila" />
        </div>
      </div>

      <div class="btns">
        <button id="btnSpeak" class="btn-ghost">🎙️ Tala in <span id="recBadge">• REC</span></button>
        <button id="btnGenerate" class="btn-primary">✨ Skapa saga (med uppläsning)</button>
        <button id="btnSaveHero" class="btn-warn">⭐ Spara hjälte</button>
        <button id="btnResetHeroes" class="btn-ghost">🧹 Rensa hjältar</button>
      </div>

      <div id="status" class="status"></div>

      <!-- Spinner för TTS/story -->
      <div id="ttsSpinner" hidden>
        <div class="dot"></div><div class="dot"></div><div class="dot"></div>
        <span id="spinnerText" class="status">Arbetar…</span>
      </div>

      <!-- Cache-mätare -->
      <div id="cacheWrap">
        <div id="cacheBarBox"><div id="cacheBar"></div></div>
        <div id="cacheText">Cache: –</div>
      </div>

      <!-- Resultat -->
      <div class="section">
        <h3>Resultat</h3>
        <div id="resultText"></div>
        <audio id="resultAudio" controls hidden></audio>
        <div id="storyImages"></div>
      </div>
    </div>
  </div>

  <script src="/app.js" defer></script>
</body>
</html>
