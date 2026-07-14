export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.12',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      'Replaced circular Reader loading with pulsing text placeholders and added the same opening effect to AI summaries.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      'Sostituito il caricamento circolare della modalita lettura con segnaposto testuali pulsanti e aggiunto lo stesso effetto all\'apertura delle sintesi IA.'
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
