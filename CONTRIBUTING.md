# Bidra till Kids-BN

Tack för ditt intresse att bidra till BN's Sagovärld!

## Lägga Till Collaborators (Medarbetare)

Om du vill ge någon skrivbehörighet till repot, följ dessa steg:

### Steg-för-steg Guide för Repository Owner

1. **Gå till GitHub-repot**
   - Navigera till ditt repository på GitHub

2. **Öppna Settings (Inställningar)**
   - Klicka på fliken **"Settings"** (högst upp till höger i menyn)
   - OBS: Denna flik är endast synlig för repository owners och admins

3. **Välj Collaborators**
   - I vänstermenyn under "Access", klicka på **"Collaborators"** (eller **"Collaborators and teams"**)
   - Du kan behöva bekräfta ditt lösenord för att fortsätta

4. **Lägg till ny collaborator**
   - Klicka på den gröna knappen **"Add people"**
   - Skriv in användarnamnet, fullständiga namnet eller e-postadressen till personen du vill bjuda in
   - Välj personen från listan som dyker upp

5. **Välj behörighetsnivå**
   - För **skrivbehörighet**, välj rollen **"Write"**
   - Write-behörighet ger möjlighet att:
     - Klona repot
     - Pusha ändringar
     - Skapa branches
     - Skapa pull requests
     - Merga pull requests (om inställt)

6. **Skicka inbjudan**
   - Klicka på knappen för att skicka inbjudan
   - Personen får ett email med en länk för att acceptera inbjudan

### Alternativa Behörighetsnivåer

- **Read**: Kan endast läsa och klona repot
- **Write**: Kan pusha ändringar (rekommenderat för aktiva utvecklare)
- **Maintain**: Write + hantera issues och pull requests
- **Admin**: Full kontroll över repot

## Utvecklingsworkflow

### Branching Strategi

- `main` - Huvudbranch (skyddad)
- Feature branches: `feature/beskrivning`
- Bugfix branches: `bugfix/beskrivning`

### Pull Request Process

1. Skapa en ny branch från `main`
2. Gör dina ändringar
3. Testa lokalt
4. Skapa en pull request
5. Vänta på code review
6. Merga efter godkännande

### Kodstil

- Använd konsekvent indentation (2 mellanslag)
- Kommentera komplex logik
- Skriv beskrivande commit-meddelanden på svenska

### Testning

Innan du pushar:
1. Testa lokalt med `wrangler pages dev`
2. Kontrollera att alla funktioner fungerar
3. Verifiera i olika webbläsare om möjligt

## Kontakt

Vid frågor eller problem, skapa ett issue i repot eller kontakta repository ownern.

## Snabbreferens: GitHub Settings Navigation

```
Repository → Settings → Collaborators → Add people
```

**Viktigt**: Endast repository owners och admins kan lägga till nya collaborators!
