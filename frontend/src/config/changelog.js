export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.4.1',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🔄 Refreshing the feed now also loads any newly available AI topic summaries without triggering a new generation.',
      '🕖 AI topic summaries are now scheduled in the configured local timezone, defaulting to Europe/Rome, so the 07:00, 13:00, and 19:00 slots happen at the expected local time.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🔄 Aggiornando il feed vengono caricate anche eventuali nuove sintesi AI gia disponibili, senza avviare una nuova generazione.',
      '🕖 Le sintesi AI per topic sono ora pianificate nel fuso orario locale configurato, di default Europe/Rome, cosi gli slot 07:00, 13:00 e 19:00 avvengono all\'ora locale corretta.'
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
