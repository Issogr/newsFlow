export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.10',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '👉 Swipe left or right on mobile AI summaries to move between topics without closing the panel; the card follows your gesture while swiping.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '👉 Scorri a sinistra o a destra sulle sintesi AI da mobile per passare tra i topic senza chiudere il pannello; la scheda segue il gesto durante lo swipe.'
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
