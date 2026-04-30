export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.13.3',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '📖 Reader mode now remembers articles you already opened and keeps long browsing sessions lighter.',
      '⚡ Long feed sessions keep the newest stories visible while trimming older retained cards and avoiding extra filter-count work when the app only needs news items.',
      '🛡️ Settings saves are safer: changes made elsewhere, like reader text size or release-note acknowledgements, are no longer overwritten by an older Settings draft.',
      '🔄 Feed refreshes report upstream problems more accurately and avoid repeatedly retrying AI topic work that already failed.',
      '🧭 Hidden search and filter panels no longer catch keyboard focus while they are closed.',
      '📎 Feedback uploads are more reliable, especially when an attachment is included.',
      '✅ Deployment checks are stricter, with test/build validation before release images are published.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '📖 La modalita lettura ora ricorda gli articoli gia aperti e mantiene piu leggere le sessioni lunghe.',
      '⚡ Le sessioni lunghe del feed mantengono visibili le notizie piu recenti, alleggerendo le card piu vecchie e evitando conteggi extra dei filtri quando servono solo le notizie.',
      '🛡️ I salvataggi delle impostazioni sono piu sicuri: modifiche fatte altrove, come dimensione del testo o note di rilascio gia viste, non vengono piu sovrascritte da una bozza vecchia.',
      '🔄 Gli aggiornamenti del feed segnalano meglio i problemi delle fonti e non riprovano all infinito gli argomenti AI gia falliti.',
      '🧭 I pannelli nascosti di ricerca e filtri non catturano piu il focus da tastiera quando sono chiusi.',
      '📎 Gli invii di feedback sono piu affidabili, soprattutto quando includono un allegato.',
      '✅ I controlli di rilascio sono piu rigorosi, con test e build prima della pubblicazione delle immagini.',
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
