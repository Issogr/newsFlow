export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.4.0',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '📎 Feedback media uploads now have more time to complete and show clearer timeout or connection errors when something goes wrong.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '📎 Gli allegati media nei feedback ora hanno piu tempo per completare il caricamento e mostrano errori piu chiari in caso di timeout o problemi di connessione.',
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
