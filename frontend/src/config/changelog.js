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
      '🧹 Duplicate stories from sibling source variants are filtered more carefully when the same headline is republished under a different URL, so fake new items and wasted AI topic checks are less likely.',
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
      '🧹 Le storie duplicate provenienti da varianti della stessa fonte vengono filtrate con piu attenzione quando lo stesso titolo viene ripubblicato con un URL diverso, cosi i falsi nuovi articoli e i controlli AI inutili sono meno probabili.',
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
