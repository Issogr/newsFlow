import { AI_ACCENT_GRADIENT_STYLE, getTopicPresentation } from '../topicPresentation';
import { getLocalizedThematicSummary, getThematicSummaryPresentationKey, isPodcastSummary } from '../utils/thematicSummaryLocale';

function removeHoverClasses(className = '') {
  return String(className).split(/\s+/u).filter((entry) => entry && !entry.startsWith('hover:')).join(' ');
}

const ThematicSummaryStories = ({ summaries = [], locale, readSummaryIds = [], t, onOpenSummary }) => {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return null;
  }

  const readSummaryIdSet = new Set(readSummaryIds);
  const podcastSummaries = summaries.filter(isPodcastSummary);
  const topicSummaries = summaries.filter((summary) => !isPodcastSummary(summary));
  const sortedSummaries = podcastSummaries.length > 0 ? [podcastSummaries[0], ...topicSummaries] : topicSummaries;

  return (
    <section className="mb-5" aria-label={t('thematicSummariesTitle')}>
      <div className="flex justify-start gap-3 overflow-x-auto py-1 [scrollbar-width:none] md:justify-center [&::-webkit-scrollbar]:hidden">
        {sortedSummaries.map((summary) => {
          const localizedSummary = getLocalizedThematicSummary(summary, locale);
          const primaryPresentation = getTopicPresentation(getThematicSummaryPresentationKey(summary));
          const circleClassName = removeHoverClasses(primaryPresentation.iconBadgeClassName);
          const PrimaryIcon = primaryPresentation.Icon;
          const isPodcast = isPodcastSummary(summary);
          const unread = isPodcast
            ? podcastSummaries.some((podcastSummary) => !readSummaryIdSet.has(podcastSummary.id))
            : !readSummaryIdSet.has(summary.id);
          const ariaLabel = isPodcast
            ? t('openPodcastSummary')
            : t('openThematicSummary', { topic: localizedSummary.displayTopicLabel });

          return (
            <button
              key={isPodcast ? 'podcast-summaries' : summary.id}
              type="button"
              onClick={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                onOpenSummary(summary);
              }}
              className="group relative inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl p-[1.5px] shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
              style={AI_ACCENT_GRADIENT_STYLE}
              aria-label={ariaLabel}
            >
              <span className={`inline-flex h-full w-full items-center justify-center rounded-[calc(1rem-1.5px)] transition-[filter] group-hover:brightness-110 ${circleClassName}`}>
                <PrimaryIcon className="h-6 w-6" aria-hidden="true" />
              </span>
              {unread && (
                <span
                  className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-white bg-violet-600 shadow-sm"
                  aria-hidden="true"
                  data-testid="thematic-summary-new-dot"
                />
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
};

export default ThematicSummaryStories;
