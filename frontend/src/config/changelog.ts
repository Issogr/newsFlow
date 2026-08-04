import type { ChangelogContent, Locale } from '../types';

export const CURRENT_CHANGELOG_ENTRY: { version: string } & Record<Locale, ChangelogContent> = {
  version: '3.6.1',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '📱 Article titles now stay limited to two lines on mobile as well as desktop.',
      '🔎 RSS discovery can now inspect larger website pages without weakening feed size limits.',
      '🌐 Feed discovery handles mixed IPv4/IPv6 sites more reliably and no longer labels connection failures as invalid URLs.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '📱 I titoli degli articoli ora restano limitati a due righe anche su mobile, come su desktop.',
      '🔎 La ricerca RSS ora puo analizzare pagine web piu grandi senza aumentare i limiti dei feed.',
      '🌐 La ricerca dei feed gestisce meglio i siti IPv4/IPv6 e non indica piu come non validi gli URL con errori di connessione.'
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
