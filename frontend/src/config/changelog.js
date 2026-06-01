export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.2',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🗂️ Thematic summaries no longer generate unused titles and use simple morning, lunch time, and evening labels instead of exact time ranges.',
      '🧽 Podcast briefings now run for morning and evening windows, keep both latest players available, and hide script text from the player panel.',
      '🛡️ Background refreshes, source setup, public API counters, and the BFF proxy are now more resilient under concurrent use.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🗂️ Le sintesi tematiche non generano piu titoli inutilizzati e usano etichette semplici come mattina, pranzo e sera invece di fasce orarie precise.',
      '🧽 I briefing podcast ora seguono le finestre mattina e sera, tengono disponibili entrambi i player piu recenti e nascondono il testo nel pannello audio.',
      '🛡️ Refresh in background, scelta fonti, contatori API pubbliche e proxy BFF sono piu solidi con utilizzo concorrente.'
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
