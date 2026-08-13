import type { ChangelogContent, Locale } from '../types';

export const CURRENT_CHANGELOG_ENTRY: { version: string } & Record<Locale, ChangelogContent> = {
  version: '3.6.3',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '📰 AI topic summaries now show only the latest briefing; the Yesterday history view has been removed.',
      '🗞️ News cards now use consistent rounded borders, subtle shadows, and mobile spacing for a minimal card layout.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '📰 Le sintesi AI per topic ora mostrano solo il briefing piu recente; la vista Ieri e stata rimossa.',
      '🗞️ Le news card ora usano bordi arrotondati, ombre leggere e spaziatura mobile coerente per un layout minimale.'
    ]
  }
};

export function getCurrentChangelog(locale: Locale = 'en') {
  const localizedEntry = CURRENT_CHANGELOG_ENTRY[locale];

  return {
    version: CURRENT_CHANGELOG_ENTRY.version,
    ...localizedEntry
  };
}
