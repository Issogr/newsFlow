export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.12',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      'Replaced circular Reader loading with pulsing text placeholders and added the same opening effect to AI summaries.',
      'Replaced numbered AI summary references with circular links that open source articles directly.',
      'Added the shared Reader font-size controls to AI summaries.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      'Sostituito il caricamento circolare della modalita lettura con segnaposto testuali pulsanti e aggiunto lo stesso effetto all\'apertura delle sintesi IA.',
      'Sostituiti i riferimenti numerati delle sintesi IA con link circolari che aprono direttamente gli articoli fonte.',
      'Aggiunti alle sintesi IA i controlli condivisi per la dimensione del testo della modalita lettura.'
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
