// (Endast createStory funktionen är här uppdaterad — ersätt motsvarande funktion i public/app.js)

async function createStory() {
  try {
    setError('');
    if (!promptEl) { setError('Prompt-fält saknas.'); return; }
    const age    = (ageEl?.value || '3-4 år').trim();
    const hero   = (heroEl?.value || '').trim();
    const prompt = (promptEl?.value || '').trim();
    if (!prompt) { setError('Skriv eller tala in en idé först.'); return; }

    showSpinner(true, 'Skapar berättelse…');
    if (createBtn) createBtn.disabled = true;

    // Försök v2 först (POST JSON) — vi ber också om JSON i Accept
    let res = await fetch("/api/generate_story", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({ ageRange: age, heroName: hero, prompt })
    });

    // Om status OK försök parse JSON, men fånga parsingfel och visa texten från servern
    if (res.ok) {
      let data = null;
      try {
        data = await res.clone().json();
      } catch (parseErr) {
        // Om parse misslyckas, hämta text och visa i error‑fältet (diagnostik)
        const txt = await res.text().catch(()=>'(kunde inte läsa body)');
        console.warn('[BN] generate_story returned non-JSON:', res.status, txt);
        throw new Error('Server svarade inte med JSON: ' + (txt.slice ? txt.slice(0,300) : String(txt)));
      }

      if (data?.story) {
        if (storyEl) storyEl.textContent = data.story;
        return;
      }
      // Om format avviker, logga och fortsätt fallback
      console.warn('[BN] generate_story ok men saknar story‑fält:', data);
    } else {
      // res.ok = false, få text för debugging
      const txt = await res.text().catch(()=>'(no body)');
      console.warn('[BN] generate_story failed', res.status, txt);
      // fortsätt till fallback
    }

    // Fallback till v1 (GET with query)
    const url = `/api/generate?ageRange=${encodeURIComponent(age)}&hero=${encodeURIComponent(hero)}&prompt=${encodeURIComponent(prompt)}`;
    const res2 = await fetch(url);
    if (!res2.ok) {
      const t = await res2.text().catch(()=>'');
      throw new Error('Båda endpoints misslyckades: ' + (t || res2.status));
    }
    const data2 = await res2.json();
    if (data2?.story) {
      if (storyEl) storyEl.textContent = data2.story;
      return;
    }
    throw new Error('Inget story i svar från v1');
  } catch (err) {
    console.error('[BN] createStory error', err);
    setError('Kunde inte skapa berättelse: ' + (err?.message || err));
  } finally {
    showSpinner(false);
    if (createBtn) createBtn.disabled = false;
  }
}
