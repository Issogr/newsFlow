import type { ChangelogContent, Locale } from '../types';

// Finalize one ID/date per announcement, after collecting all commits in the batch.
export const CURRENT_CHANGELOG_ENTRY: { id: string; date: string } & Record<Locale, ChangelogContent> = {
  id: '2026-09-21-01',
  date: '2026-09-21',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🎨 A calmer, consistent design across the app, with clearer headlines, labeled topic summaries, and shared controls that keep your familiar colors, icons, and reading features.',
      '✨ AI summaries now check source support and translations before publication, with more context per story and improved shopping filters.',
      '🗓️ Summaries show their coverage dates and outdated status, and refresh when source articles change.',
      '📰 Removed podcast briefings and audio playback; daily AI text summaries remain available.',
      '📣 Updates now use dated release notes instead of version numbers, with the latest notes always available in Settings.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🎨 Un design più essenziale e coerente in tutta l’app, con titoli più leggibili, etichette per le sintesi tematiche e controlli uniformi, mantenendo colori, icone e funzioni di lettura.',
      '✨ Le sintesi IA ora controllano il supporto delle fonti e le traduzioni prima della pubblicazione, con più contesto per notizia e filtri promozionali migliorati.',
      '🗓️ Le sintesi mostrano il periodo coperto e lo stato di aggiornamento, e si rigenerano quando cambiano gli articoli fonte.',
      '📰 Rimossi i briefing podcast e la riproduzione audio; le sintesi testuali IA giornaliere restano disponibili.',
      '📣 Gli aggiornamenti ora usano note datate al posto dei numeri di versione, sempre disponibili nelle Impostazioni.'
    ]
  }
};

export function getCurrentChangelog(locale: Locale = 'en') {
  const localizedEntry = CURRENT_CHANGELOG_ENTRY[locale];

  return {
    id: CURRENT_CHANGELOG_ENTRY.id,
    date: CURRENT_CHANGELOG_ENTRY.date,
    dateLabel: CURRENT_CHANGELOG_ENTRY.date
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${CURRENT_CHANGELOG_ENTRY.date}T00:00:00Z`))
      : '',
    ...localizedEntry
  };
}
