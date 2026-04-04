export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.8',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'Here is a quick overview of the latest changes in News Flow.',
    items: [
      '🔗 When sharing falls back to clipboard copy on desktop, you now get a small confirmation bubble instead of guessing what happened.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Ecco una panoramica rapida delle ultime novita di News Flow.',
    items: [
      '🔗 Quando la condivisione su desktop usa la copia negli appunti come fallback, ora compare un piccolo avviso di conferma invece di lasciare il risultato implicito.',
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
