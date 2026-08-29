import type { ChangelogContent, Locale } from '../types';

export const CURRENT_CHANGELOG_ENTRY: { version: string } & Record<Locale, ChangelogContent> = {
  version: '3.7.0',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🔐 After upgrading, sign in again because existing browser sessions cannot be migrated.',
      '📰 Clearer news-card headers keep sources, dates, and actions together on one line on mobile and desktop.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🔐 Dopo l\'aggiornamento, accedi di nuovo perche le sessioni browser esistenti non possono essere migrate.',
      '📰 Le intestazioni piu chiare mantengono fonti, date e azioni insieme su una riga su mobile e desktop.'
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
