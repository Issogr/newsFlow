import type { ChangelogContent, Locale } from '../types';

export const CURRENT_CHANGELOG_ENTRY: { version: string } & Record<Locale, ChangelogContent> = {
  version: '3.7.0',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '✨ AI summaries now check source support and translations before publication, with more context per story and improved shopping filters.',
      '🗓️ Summaries show their coverage dates and outdated status, and refresh when source articles change.',
      '🎧 Podcasts now use native browser audio controls, with the same back and forward skip buttons.',
      '🔐 After upgrading, sign in again because existing browser sessions cannot be migrated.',
      '📰 Clearer news-card headers keep sources, dates, and actions together on one line on mobile and desktop.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '✨ Le sintesi IA ora controllano il supporto delle fonti e le traduzioni prima della pubblicazione, con più contesto per notizia e filtri promozionali migliorati.',
      '🗓️ Le sintesi mostrano il periodo coperto e lo stato di aggiornamento, e si rigenerano quando cambiano gli articoli fonte.',
      '🎧 I podcast ora usano i controlli audio nativi del browser, con gli stessi pulsanti per saltare indietro e avanti.',
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
