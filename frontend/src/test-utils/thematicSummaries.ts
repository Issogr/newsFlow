import type { ThematicSummary } from '../types';

export function createPodcastSummary(overrides: Partial<ThematicSummary> = {}): ThematicSummary {
  return {
    id: 'podcast-1',
    type: 'podcast',
    topicKey: 'podcast',
    topicLabel: 'Podcast',
    periodStart: '2026-05-21T05:00:00.000Z',
    periodEnd: '2026-05-21T11:00:00.000Z',
    articleCount: 2,
    titleByLocale: { en: 'Morning podcast', it: 'Podcast del mattino' },
    summaryTextByLocale: { en: 'English script', it: 'Testo podcast italiano' },
    ...overrides
  };
}
