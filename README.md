# Kids-BN - BN's Sagovärld 📚✨

En magisk webbapplikation för att skapa personliga sagor för barn med hjälp av AI.

## 🌟 Funktioner

- **Åldersanpassade sagor**: Skapa berättelser anpassade för barn 1-12 år
- **Personliga hjältar**: Lägg till barnets favoritkaraktärer i sagan
- **AI-genererade berättelser**: Använder Claude AI för att skapa unika sagor
- **Uppläsning**: Text-till-tal funktionalitet för att lyssna på sagorna
- **Illustrationer**: Generera bilder till sagorna

## 🛠️ Teknisk Stack

- **Platform**: Cloudflare Pages + Workers
- **Frontend**: Vanilla JavaScript, HTML, CSS
- **Backend**: Cloudflare Functions
- **Database**: Cloudflare D1 (SQL)
- **Storage**: Cloudflare R2 (audio och bilder)
- **AI**: Claude (sagor), OpenAI (bilder), ElevenLabs (röst)

## 📦 Installation

1. **Klona repository:**
   ```bash
   git clone https://github.com/Bjortab/Kids-BN.git
   cd Kids-BN
   ```

2. **Installera Wrangler CLI:**
   ```bash
   npm install -g wrangler
   ```

3. **Konfigurera secrets:**
   ```bash
   wrangler secret put ANTHROPIC_API_KEY
   wrangler secret put OPENAI_API_KEY
   wrangler secret put ELEVENLABS_API_KEY
   ```

4. **Uppdatera wrangler.toml:**
   - Ändra `database_id` till ditt D1-databas ID
   - Anpassa `BN_ALLOWED_ORIGIN` till din domän

## 🚀 Utveckling

```bash
# Kör lokalt
wrangler pages dev public

# Deploy till Cloudflare Pages
wrangler pages deploy public
```

## 🔧 Konfiguration

Se `wrangler.toml` för alla konfigurationsalternativ.

Viktiga variabler:
- `APP`: Applikationsnamn ("kids")
- `BN_ENV`: Miljö (production/preview)
- `LANG_DEFAULT`: Standardspråk för sagor ("sv" eller "en")
- `MODEL_CLAUDE`: AI-modell för sagogenerering

## 📁 Projektstruktur

```
Kids-BN/
├── public/           # Statiska filer (frontend)
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── functions/        # Cloudflare Functions (backend API)
│   ├── generate.js   # Sagogenerering
│   ├── tts.js        # Text-till-tal
│   ├── art.js        # Bildgenerering
│   └── api/          # API endpoints
├── migrations/       # D1 databasmigrationer
├── assets/           # Tillgångar
└── wrangler.toml     # Cloudflare konfiguration
```

## 🤝 Bidra

Vi välkomnar bidrag! Se vår guide för hur du bidrar:

1. Forka repository
2. Skapa en feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit dina ändringar (`git commit -m 'Add some AmazingFeature'`)
4. Push till branchen (`git push origin feature/AmazingFeature`)
5. Öppna en Pull Request

### GitHub Copilot

Om du vill använda GitHub Copilot i detta projekt, se vår guide:
[GITHUB_COPILOT.md](./GITHUB_COPILOT.md)

## 📝 Licens

Detta projekt är privat och ägs av Bjortab.

## 🐛 Rapportera Buggar

Om du hittar en bugg, vänligen öppna ett issue med:
- Beskrivning av problemet
- Steg för att återskapa
- Förväntat beteende
- Faktiskt beteende
- Skärmdumpar (om relevant)

## 💬 Support

- **Dokumentation**: Se projektets Wiki (om tillgänglig)
- **GitHub Issues**: För buggar och feature requests
- **GitHub Copilot hjälp**: [GITHUB_COPILOT.md](./GITHUB_COPILOT.md)

## 🙏 Tack

Tack till alla som bidragit till detta projekt!

---

Skapad med ❤️ för barns fantasi
