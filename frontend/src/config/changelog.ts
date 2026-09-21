import type { ChangelogContent, Locale } from '../types';
import releaseMetadata from './release.json';

// CI writes release.json before building the published image; local builds stay unpublished.
export const CURRENT_CHANGELOG_ENTRY: typeof releaseMetadata & Record<Locale, ChangelogContent> = {
  ...releaseMetadata,
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'The full changelog on GitHub lists the commits included in each update, with links to the changes.'
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Il changelog completo su GitHub elenca i commit inclusi in ogni aggiornamento, con i link alle modifiche.'
  }
};

export function getCurrentChangelog(locale: Locale = 'en') {
  const localizedEntry = CURRENT_CHANGELOG_ENTRY[locale];

  return {
    id: CURRENT_CHANGELOG_ENTRY.id,
    date: CURRENT_CHANGELOG_ENTRY.date,
    url: CURRENT_CHANGELOG_ENTRY.url,
    dateLabel: CURRENT_CHANGELOG_ENTRY.date
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${CURRENT_CHANGELOG_ENTRY.date}T00:00:00Z`))
      : '',
    ...localizedEntry
  };
}
