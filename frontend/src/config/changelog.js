export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.13',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🤖 AI topic detection can optionally assign cleaner categories, now runs in the background, handles slower models better, and retries stories skipped by temporary caps or failures.',
      '🏷️ Topic matching is stricter and clearer, so mislabels are less likely and confidence or evidence is easier to inspect when something looks off.',
      '🟢 Source refresh is smarter too: active users get a quicker catch-up, and shared custom RSS feeds are fetched once and reused safely across users.',
      '🏷️ Standard story cards show topic icons again, with a rainbow ring when a topic was classified by AI.',
      '⚡ Feed paging, session activity, and browser-gateway requests now do less unnecessary work and stay more resilient when the backend is slow or input is malformed.',
      '🧰 Local development and dependencies were also refreshed, including the frontend build pipeline.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🤖 Il rilevamento AI dei topic puo assegnare categorie piu precise, ora lavora in background, gestisce meglio i modelli lenti e riprova gli articoli saltati per limiti o errori temporanei.',
      '🏷️ Il riconoscimento dei topic e piu rigoroso e piu chiaro, cosi gli errori di etichetta sono meno probabili e confidenza o evidenze sono piu facili da controllare.',
      '🟢 Anche l aggiornamento delle fonti e piu intelligente: gli utenti attivi recuperano prima le novita e le fonti RSS personalizzate condivise vengono scaricate una volta sola e riusate in sicurezza.',
      '🏷️ Le schede standard mostrano di nuovo le icone dei topic, con un anello arcobaleno quando il topic arriva dall AI.',
      '⚡ Paginazione del feed, attivita di sessione e richieste attraverso il gateway browser fanno meno lavoro inutile e restano piu affidabili quando il backend rallenta o l input non e valido.',
      '🧰 Sono stati aggiornati anche sviluppo locale e dipendenze, incluso il processo di build del frontend.',
    ]
  }
};

export function getCurrentChangelog(locale = 'en') {
  const localizedEntry = CURRENT_CHANGELOG_ENTRY[locale] || CURRENT_CHANGELOG_ENTRY.en;

  return {
    version: CURRENT_CHANGELOG_ENTRY.version,
    ...localizedEntry
  };
}
