export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.12',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '⏳ Replaced circular Reader loading with pulsing text placeholders and added the same opening effect to AI summaries.',
      '🔗 Replaced numbered AI summary references with circular links that open source articles directly.',
      '🔠 Added the shared Reader font-size controls to AI summaries.',
      '↔️ Added persistent 64, 72, and 80-character reading widths to Reader mode, AI summaries, and Settings, with width controls hidden on full-screen mobile views.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '⏳ Sostituito il caricamento circolare della modalita lettura con segnaposto testuali pulsanti e aggiunto lo stesso effetto all\'apertura delle sintesi IA.',
      '🔗 Sostituiti i riferimenti numerati delle sintesi IA con link circolari che aprono direttamente gli articoli fonte.',
      '🔠 Aggiunti alle sintesi IA i controlli condivisi per la dimensione del testo della modalita lettura.',
      '↔️ Aggiunte larghezze di lettura persistenti da 64, 72 e 80 caratteri alla modalita lettura, alle sintesi IA e alle Impostazioni, nascondendo i controlli di larghezza nelle viste mobili a schermo intero.'
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
