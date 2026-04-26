export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.13.1',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🤖 Stories reclassified by AI in the background now refresh automatically in the live feed, so new topic labels appear without a manual reload when auto refresh is active.',
      '📰 When live auto refresh is off, opening the app now waits for one quick follow-up feed refresh so fresh stories are less likely to require a manual refresh.',
      '🏷️ Topic-filtered views also catch up sooner when those background AI labels change what should be visible.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🤖 Gli articoli riclassificati dall AI in background ora aggiornano automaticamente il feed live, cosi i nuovi topic compaiono senza ricaricare la pagina quando l auto refresh e attivo.',
      '📰 Quando l auto refresh live e spento, aprire l app ora aspetta un rapido aggiornamento aggiuntivo del feed cosi le notizie nuove hanno meno probabilita di richiedere un refresh manuale.',
      '🏷️ Anche le viste filtrate per topic si aggiornano prima quando queste etichette AI cambiano cio che deve essere mostrato.',
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
