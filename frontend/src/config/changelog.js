export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.13',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: []
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: []
  }
};

export function getCurrentChangelog(locale = 'en') {
  const localizedEntry = CURRENT_CHANGELOG_ENTRY[locale] || CURRENT_CHANGELOG_ENTRY.en;

  return {
    version: CURRENT_CHANGELOG_ENTRY.version,
    ...localizedEntry
  };
}
