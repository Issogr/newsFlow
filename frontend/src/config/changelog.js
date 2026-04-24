export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.12',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🤖 Topic detection can now use AI for cleaner news categories when configured.',
      '🔐 Security around browser sessions and live updates is stricter.',
      '🚪 Logging out is more reliable, even if the server is having trouble.',
      '📄 Feed pagination is more predictable when moving through older results.',
      '🌊 Refreshes are calmer under load because RSS sources are fetched in controlled batches.',
      '🔁 Shared custom RSS feeds are refreshed once and reused safely across users.',
      '⚡ Scrolling and loading more stories should feel smoother, with fewer stuck loading states.',
      '⌨️ Mobile search now stays visible when the keyboard opens.',
      '🖼️ Stories without official images now rotate through more fallback covers.',
      '🧹 Repeated stories from the same source are cleaned up more reliably.',
      '🔗 Sharing now shows a clear message if the browser blocks copying the link.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🤖 Il rilevamento degli argomenti puo usare l\'AI per categorie piu precise, se configurata.',
      '🔐 La sicurezza delle sessioni browser e degli aggiornamenti live e piu rigorosa.',
      '🚪 Il logout e piu affidabile, anche se il server sta avendo problemi.',
      '📄 La paginazione delle notizie e piu prevedibile quando scorri verso i risultati meno recenti.',
      '🌊 Gli aggiornamenti sono piu stabili sotto carico perche le fonti RSS vengono lette in gruppi controllati.',
      '🔁 Le fonti RSS personalizzate condivise vengono aggiornate una sola volta e riusate in sicurezza tra utenti.',
      '⚡ Scroll e caricamento di altre notizie dovrebbero risultare piu fluidi, con meno stati di caricamento bloccati.',
      '⌨️ La ricerca su mobile resta visibile quando si apre la tastiera.',
      '🖼️ Le notizie senza immagine ufficiale ora alternano piu copertine di fallback.',
      '🧹 Le notizie ripetute dalla stessa fonte vengono ripulite in modo piu affidabile.',
      '🔗 La condivisione ora mostra un messaggio chiaro se il browser blocca la copia del link.',
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
