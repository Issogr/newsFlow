export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.4.0',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🔖 Save articles to Read later from each news card and open them from a dedicated view, even after they leave the normal feed window.',
      '📎 Feedback media uploads now have more time to complete and show clearer timeout or connection errors when something goes wrong.',
      '🛡️ Custom RSS edits and reader-mode edge cases are safer, preserving saved articles and avoiding stale fallback reader content.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🔖 Salva gli articoli in Leggi dopo da ogni scheda e ritrovali in una vista dedicata anche quando escono dal feed normale.',
      '📎 Gli allegati media nei feedback ora hanno piu tempo per completare il caricamento e mostrano errori piu chiari in caso di timeout o problemi di connessione.',
      '🛡️ Le modifiche agli RSS personalizzati e i casi limite della modalita lettura sono piu sicuri: gli articoli salvati restano disponibili e i fallback temporanei non restano in cache.',
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
