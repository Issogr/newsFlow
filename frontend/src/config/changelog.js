export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.8',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '📖 Kept reader mode titles anchored to the feed article title so loading reader content no longer replaces them.',
      '✨ Synced AI summary read badges across devices so summaries opened elsewhere no longer appear new.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '📖 Mantenuto il titolo della modalita lettura uguale a quello del feed, evitando che il contenuto caricato lo sostituisca.',
      '✨ Sincronizzati tra dispositivi gli indicatori delle sintesi AI lette, cosi quelle gia aperte altrove non risultano nuove.'
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
