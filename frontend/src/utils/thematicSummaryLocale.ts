import { getLocalizedTopic } from '../i18n';
import type { Locale, ThematicSummary } from '../types';

export function isPodcastSummary(summary: Partial<ThematicSummary> = {}): boolean {
  return summary?.type === 'podcast' || summary?.topicKey === 'podcast';
}

export function getThematicSummaryPresentationKey(summary: Partial<ThematicSummary> = {}) {
  return summary.topicKey || summary.topics?.[0] || summary.topicLabel;
}

export function getLocalizedThematicSummary(summary: Partial<ThematicSummary> = {}, locale: Locale = 'en') {
  const supportedLocale = locale === 'it' ? 'it' : 'en';
  const fallbackLocale = supportedLocale === 'it' ? 'en' : 'it';
  const topicLabel = getLocalizedTopic(summary.topicKey, supportedLocale, '')
    || getLocalizedTopic(summary.topicKey, fallbackLocale, '');

  return {
    ...summary,
    displayTopicLabel: topicLabel || summary.topicLabel || '',
    displaySummaryText: summary.summaryTextByLocale?.[supportedLocale] || summary.summaryTextByLocale?.[fallbackLocale] || summary.summaryText || ''
  };
}
