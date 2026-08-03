import type { ChangelogContent, Locale } from '../types';

export const CURRENT_CHANGELOG_ENTRY: { version: string } & Record<Locale, ChangelogContent> = {
  version: '3.6.0',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🔎 Add RSS and Atom feeds from a dedicated window, then manage and save or discard source changes in Settings.',
      '🧹 Removed clickbait classification and labels.',
      '🌙 AI summaries and podcasts now run once daily at 20:00.',
      '📅 Switch between today\'s and yesterday\'s AI summaries with clearer controls.',
      '📰 News card headlines now stay compact at a maximum of two lines.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🔎 Aggiungi feed RSS e Atom da una finestra dedicata, poi salva o annulla le modifiche alle fonti nelle Impostazioni.',
      '🧹 Rimosse la classificazione e le etichette clickbait.',
      '🌙 Sintesi AI e podcast ora vengono generati una volta al giorno alle 20:00.',
      '📅 Passa tra le sintesi AI di oggi e ieri con controlli piu chiari.',
      '📰 I titoli delle notizie ora restano compatti, con un massimo di due righe.'
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
