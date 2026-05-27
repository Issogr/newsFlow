export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.2',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🧽 Podcast briefings now run for morning and evening windows, keep both latest players available, and hide script text from the player panel.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🧽 I briefing podcast ora seguono le finestre mattina e sera, tengono disponibili entrambi i player piu recenti e nascondono il testo nel pannello audio.'
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
