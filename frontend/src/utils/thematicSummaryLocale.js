const TOPIC_LABELS = {
  technology: { en: 'Technology', it: 'Tecnologia' },
  politics: { en: 'Politics', it: 'Politica' },
  crime: { en: 'Crime', it: 'Cronaca' },
  sport: { en: 'Sport', it: 'Sport' },
  entertainment: { en: 'Entertainment', it: 'Spettacolo' },
  science: { en: 'Science', it: 'Scienza' },
  podcast: { en: 'News podcast', it: 'Podcast news' }
};

function getSupportedLocale(locale) {
  return locale === 'it' ? 'it' : 'en';
}

export function isPodcastSummary(summary = {}) {
  return summary?.type === 'podcast' || summary?.topicKey === 'podcast';
}

export function getThematicSummaryPresentationKey(summary = {}) {
  return summary.topicKey || summary.topics?.[0] || summary.topicLabel;
}

export function getLocalizedThematicSummary(summary = {}, locale = 'en') {
  const supportedLocale = getSupportedLocale(locale);
  const fallbackLocale = supportedLocale === 'it' ? 'en' : 'it';
  const topicLabels = TOPIC_LABELS[summary.topicKey] || {};

  return {
    ...summary,
    displayTopicLabel: topicLabels[supportedLocale] || topicLabels[fallbackLocale] || summary.topicLabel || '',
    displaySummaryText: summary.summaryTextByLocale?.[supportedLocale] || summary.summaryTextByLocale?.[fallbackLocale] || summary.summaryText || ''
  };
}
