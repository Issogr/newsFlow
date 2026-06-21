export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.8',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '📌 Clarified card actions with Read here for the in-app reader and Open original for publisher links.',
      '📖 Kept reader mode titles anchored to the feed article title so loading reader content no longer replaces them.',
      '✨ Synced AI summary read badges across devices so summaries opened elsewhere no longer appear new.',
      '📰 Kept grouped reader-mode source links in one horizontal scroll row so large story clusters stay readable.',
      '⚡ Made AI topic stories faster and more reliable, with coherent summary windows and better retry handling.',
      '🕗 Moved AI summaries and podcast briefings to 08:00 and 20:00 local time.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '📌 Chiarite le azioni delle card: Leggi qui apre la lettura interna, Apri originale apre il sito dell\'editore.',
      '📖 Mantenuto il titolo della modalita lettura uguale a quello del feed, evitando che il contenuto caricato lo sostituisca.',
      '✨ Sincronizzati tra dispositivi gli indicatori delle sintesi AI lette, cosi quelle gia aperte altrove non risultano nuove.',
      '📰 Mantenuti i link alle fonti raggruppate in una sola riga scorrevole nella modalita lettura, cosi i gruppi grandi restano leggibili.',
      '⚡ Rese le storie AI per topic piu rapide e affidabili, con finestre di sintesi coerenti e retry migliorati.',
      '🕗 Spostate le sintesi AI e i briefing podcast alle 08:00 e alle 20:00 locali.'
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
