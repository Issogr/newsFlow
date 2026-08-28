import type { ChangelogContent, Locale } from '../types';

export const CURRENT_CHANGELOG_ENTRY: { version: string } & Record<Locale, ChangelogContent> = {
  version: '3.6.4',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '📱 News cards keep equal heights across desktop rows while sizing independently to their content on mobile.',
      '🗞️ Similar stories now regroup reliably after article updates and background AI processing.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '📱 Le news card mantengono la stessa altezza nelle righe desktop, mentre su mobile si adattano in modo indipendente ai propri contenuti.',
      '🗞️ Le notizie simili ora vengono raggruppate correttamente dopo gli aggiornamenti degli articoli e l\'elaborazione AI in background.'
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
