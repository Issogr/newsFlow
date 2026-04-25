export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.13',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🤖 Topic detection can now use AI for cleaner news categories when configured.',
      '🧠 AI topic detection now works in the background so fresh news loads faster.',
      '🤖 AI topic detection is more patient with slower models and better at reading model responses.',
      '🏷️ Topic matching is stricter, so incident stories are less likely to be mislabeled as technology or local news.',
      '🟢 Sources now refresh around active users, with a quick catch-up when you return.',
      '🔁 Shared custom RSS feeds are refreshed once and reused safely across users.',
      '🏷️ Standard story cards show simple topic icons again for quicker scanning.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🤖 Il rilevamento degli argomenti puo usare l\'AI per categorie piu precise, se configurata.',
      '🧠 Il rilevamento AI dei topic ora lavora in background, cosi le notizie si caricano piu rapidamente.',
      '🤖 Il rilevamento AI dei topic e piu paziente con i modelli lenti e interpreta meglio le risposte.',
      '🏷️ Il riconoscimento dei topic e piu rigoroso, cosi gli articoli di cronaca vengono etichettati meglio.',
      '🟢 Le fonti ora si aggiornano in base agli utenti attivi, con un recupero rapido quando torni.',
      '🔁 Le fonti RSS personalizzate condivise vengono aggiornate una sola volta e riusate in sicurezza tra utenti.',
      '🏷️ Le schede standard mostrano di nuovo semplici icone dei topic per orientarti piu in fretta.',
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
