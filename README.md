# BN's Sagovärld (Kids-BN)

En interaktiv webbapplikation för att skapa och lyssna på barnberättelser med AI-teknik.

## Om Projektet

Detta projekt är en Cloudflare Pages-applikation som använder:
- AI för att generera berättelser (Claude)
- Text-till-tal för uppläsning (ElevenLabs)
- Bildgenerering för illustrationer
- D1 databas för lagring
- R2 bucket för ljud och bilder

## Teknisk Stack

- **Frontend**: Vanilla JavaScript, HTML, CSS
- **Backend**: Cloudflare Workers/Functions
- **Databas**: Cloudflare D1 (SQL)
- **Storage**: Cloudflare R2
- **Deploy**: Cloudflare Pages

## Kom Igång

### Förutsättningar

- Node.js (v18 eller senare) och npm
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare-konto med Pages, D1, och R2 uppsatt

### Installation

1. Klona repot
2. Installera Wrangler CLI (kräver Node.js): `npm install -g wrangler`
3. Konfigurera `wrangler.toml` med dina egna:
   - D1 database ID (`database_id`)
   - Domän (`BN_ALLOWED_ORIGIN`)
   - ElevenLabs röst-ID (`ELEVENLABS_VOICE_ID`)
4. Lägg till API-nycklar som secrets:
   ```bash
   wrangler secret put OPENAI_API_KEY
   wrangler secret put ANTHROPIC_API_KEY
   wrangler secret put ELEVENLABS_API_KEY
   ```
5. Kör `wrangler pages dev` för lokal utveckling
6. Deploy med `wrangler pages deploy`

## Samarbete

Se [CONTRIBUTING.md](CONTRIBUTING.md) för information om hur du lägger till medarbetare och bidrar till projektet.

## Projektstruktur

```
.
├── public/           # Frontend-filer (HTML, CSS, JS)
├── functions/        # Cloudflare Workers-funktioner (API)
├── migrations/       # Databasmigreringar
├── assets/          # Statiska resurser
└── wrangler.toml    # Cloudflare-konfiguration
```

## Licens

Detta är ett privat projekt.
