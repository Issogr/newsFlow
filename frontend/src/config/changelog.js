export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.10.3',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '📱 Privacy Policy, Cookie Policy, API docs, and the admin dashboard now feel cleaner on mobile with full-screen layouts.',
      '🪄 Legal links now match the settings pill style, and the main settings action is simplified to `Save`.',
      '🖼️ The generic news fallback cover is now much lighter, so placeholder images cost less to load.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '📱 Privacy Policy, Cookie Policy, documentazione API e dashboard admin ora risultano piu pulite su mobile con layout a schermo intero.',
      '🪄 I link ai documenti legali ora seguono lo stesso stile a pill delle impostazioni, e l\'azione principale delle impostazioni e stata semplificata in `Salva`.',
      '🖼️ L\'immagine generica di fallback per le notizie ora e molto piu leggera, cosi i placeholder pesano meno da caricare.',
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
