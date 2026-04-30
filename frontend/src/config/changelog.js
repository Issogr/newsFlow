export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.13.3',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🧹 A code audit cleaned up duplicated and stale paths so sharing, release notes, reader mode, and API reads stay easier to keep consistent.',
      '🛡️ Runtime edge cases are safer, including feed settings, proxy headers, session cleanup, and AI topic batches that hit their processing cap.',
      '🧯 Feed pagination, reconnects, and reader-mode edge cases are steadier, with fewer duplicate loads and fewer stale errors.',
      '📖 Reader mode now remembers articles you already opened and keeps long browsing sessions lighter.',
      '⚡ Long feed sessions keep the newest stories visible while trimming older retained cards and avoiding extra filter-count work when the app only needs news items.',
      '🛡️ Settings saves are safer: changes made elsewhere, like reader text size or release-note acknowledgements, are no longer overwritten by an older Settings draft.',
      '🔄 Feed refreshes report upstream problems more accurately and avoid repeatedly retrying AI topic work that already failed.',
      '🧭 Hidden search and filter panels no longer catch keyboard focus while they are closed.',
      '📎 Feedback uploads are more reliable, especially when an attachment is included.',
      '🚦 Long feed sessions now stop asking for older pages once the app has reached its retained-card limit.',
      '🔎 Search, custom-source updates, and private-source labels behave more consistently in edge cases.',
      '🔐 Browser session handling and deployment proxy defaults are stricter at the app boundary.',
      '✅ Deployment checks are stricter, with test/build validation before release images are published.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🧹 Un audit del codice ha ripulito percorsi duplicati o non piu usati, cosi condivisione, note di rilascio, lettura e API restano piu coerenti.',
      '🛡️ I casi limite di runtime sono piu sicuri, incluse impostazioni feed, header proxy, pulizia sessioni e batch AI che raggiungono il limite.',
      '🧯 Paginazione del feed, riconnessioni e casi limite della modalita lettura sono piu stabili, con meno caricamenti duplicati e meno errori rimasti in pagina.',
      '📖 La modalita lettura ora ricorda gli articoli gia aperti e mantiene piu leggere le sessioni lunghe.',
      '⚡ Le sessioni lunghe del feed mantengono visibili le notizie piu recenti, alleggerendo le card piu vecchie e evitando conteggi extra dei filtri quando servono solo le notizie.',
      '🛡️ I salvataggi delle impostazioni sono piu sicuri: modifiche fatte altrove, come dimensione del testo o note di rilascio gia viste, non vengono piu sovrascritte da una bozza vecchia.',
      '🔄 Gli aggiornamenti del feed segnalano meglio i problemi delle fonti e non riprovano all infinito gli argomenti AI gia falliti.',
      '🧭 I pannelli nascosti di ricerca e filtri non catturano piu il focus da tastiera quando sono chiusi.',
      '📎 Gli invii di feedback sono piu affidabili, soprattutto quando includono un allegato.',
      '🚦 Nelle sessioni lunghe, il feed smette di chiedere pagine piu vecchie quando raggiunge il limite di card mantenute.',
      '🔎 Ricerca, aggiornamenti delle fonti personalizzate ed etichette delle fonti private sono piu coerenti nei casi limite.',
      '🔐 La gestione delle sessioni browser e le impostazioni proxy di deploy sono piu rigorose al confine dell app.',
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
