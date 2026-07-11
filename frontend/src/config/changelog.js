export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.11',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      'Article retention now follows the app-wide server setting only, so the settings panel no longer offers a per-user retention field.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      'La retention degli articoli ora segue solo l\'impostazione server globale, quindi nelle impostazioni non c\'e piu un campo per utente.'
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
