export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.11',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🧹 Article retention now follows the app-wide server setting only, so the settings panel no longer offers a per-user retention field.',
      '⏱️ The latest-hours quick filter and its settings field were removed because the feed is already ordered by age and paginated.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🧹 La retention degli articoli ora segue solo l\'impostazione server globale, quindi nelle impostazioni non c\'e piu un campo per utente.',
      '⏱️ Il filtro rapido sulle ultime ore e il relativo campo impostazioni sono stati rimossi perche il feed e gia ordinato per data e paginato.'
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
