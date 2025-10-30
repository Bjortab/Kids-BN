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

- Node.js och npm
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare-konto

### Installation

1. Klona repot
2. Konfigurera `wrangler.toml` med dina egna ID:n och API-nycklar
3. Kör `wrangler pages dev` för lokal utveckling
4. Deploy med `wrangler pages deploy`

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
