export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.13.3',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '⚡ Feed refreshes start faster, handle slow sources better, and keep long sessions focused on the newest stories.',
      '🗞️ Related articles are grouped into cleaner story cards again, with steadier pagination, reconnects, and search behavior.',
      '📖 Reader mode remembers opened articles, stays lighter during long sessions, and avoids stale edge-case errors.',
      '🛡️ Settings, custom sources, language storage, sessions, and proxy handling are safer in more edge cases.',
      '📎 Feedback uploads, sharing, release notes, API reads, and release checks are more reliable and easier to maintain.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '⚡ Gli aggiornamenti del feed partono piu rapidamente, gestiscono meglio le fonti lente e mantengono in vista le notizie piu recenti nelle sessioni lunghe.',
      '🗞️ Gli articoli collegati tornano in card storia piu pulite, con paginazione, riconnessioni e ricerca piu stabili.',
      '📖 La modalita lettura ricorda gli articoli gia aperti, resta piu leggera nelle sessioni lunghe e evita errori rimasti in pagina.',
      '🛡️ Impostazioni, fonti personalizzate, lingua, sessioni e proxy sono piu sicuri in piu casi limite.',
      '📎 Feedback, condivisione, note di rilascio, letture API e controlli di release sono piu affidabili e semplici da mantenere.',
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
