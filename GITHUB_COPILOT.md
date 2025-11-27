# GitHub Copilot för Kids-BN

## Problemlösning: Hitta rätt "Copilot"

Om du försöker lägga till GitHub Copilot som collaborator och ser många namn som "copilote612", "copilotdev" osv i rullistan, men inte hittar bara "copilot", är det viktigt att förstå skillnaden mellan:

1. **GitHub Copilot som verktyg/app** - detta är AI-kodningsassistenten
2. **GitHub-användare med liknande namn** - riktiga användare vars användarnamn innehåller "copilot"

## Lösning: Hur man använder GitHub Copilot

GitHub Copilot är **inte** en collaborator som du lägger till i repository-inställningarna. Istället är det ett verktyg som utvecklare aktiverar i sin egen miljö.

### För Repository-ägare

Du behöver **inte** lägga till "copilot" som collaborator. GitHub Copilot fungerar automatiskt för alla som har:

1. **GitHub Copilot-prenumeration** (individuell eller företag)
2. **Tillgång till repository** (genom att vara collaborator eller medlem av organisationen)

### För Utvecklare som vill använda GitHub Copilot

1. **Aktivera GitHub Copilot:**
   - Gå till [github.com/settings/copilot](https://github.com/settings/copilot)
   - Aktivera GitHub Copilot för ditt konto
   - Om du är del av en organisation kan administratören ge dig tillgång

2. **Installera GitHub Copilot-extension:**
   - **VS Code**: Sök efter "GitHub Copilot" i Extensions
   - **JetBrains IDEs**: Installera från Plugin Marketplace
   - **Neovim**: Använd [copilot.vim](https://github.com/github/copilot.vim)

3. **Logga in:**
   - Öppna din editor
   - Följ prompten för att autentisera med GitHub

### Om GitHub Copilot Chat/Workspace

Om du vill ge GitHub Copilot (bot) tillgång att kommentera på pull requests eller issues:

1. Gå till repository-inställningar
2. Välj **"Actions" → "General"**
3. Under "Workflow permissions", aktivera nödvändiga behörigheter
4. Du kan också lägga till GitHub Apps under **"Integrations" → "GitHub Apps"**

## Vanliga missförstånd

❌ **Fel:** Försöker lägga till "copilot" som collaborator genom att söka användarnamn
✅ **Rätt:** Aktivera GitHub Copilot i dina personliga inställningar och editor

❌ **Fel:** Tror att "copilot" är en GitHub-användare
✅ **Rätt:** GitHub Copilot är ett AI-verktyg, inte en användare

## Behöver du verkligen lägga till en Copilot-bot?

Om du använder **GitHub Copilot Workspace** eller vill att en bot ska kunna:
- Skapa pull requests
- Kommentera på issues
- Automatisera kodändringar

Då kan du behöva:
1. Installera GitHub Copilot som en **GitHub App** (inte collaborator)
2. Gå till repository → Settings → Integrations → GitHub Apps
3. Konfigurera behörigheter

## Ytterligare hjälp

**Observera**: Länkarna nedan är till GitHubs officiella dokumentation på engelska.

- [GitHub Copilot Dokumentation](https://docs.github.com/en/copilot)
- [GitHub Copilot för Business](https://docs.github.com/en/copilot/overview-of-github-copilot/about-github-copilot-business)
- [GitHub Apps vs Collaborators](https://docs.github.com/en/apps/overview)

## Kontakt

Om du fortfarande har problem, kontakta:
- GitHub Support: [support.github.com](https://support.github.com)
- Repository-administratör
