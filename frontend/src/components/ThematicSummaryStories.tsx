import { AI_ACCENT_GRADIENT_STYLE, getTopicPresentation } from '../topicPresentation';
import { getLocalizedThematicSummary, getThematicSummaryPresentationKey } from '../utils/thematicSummaryLocale';
import type { Locale, ThematicSummary, Translator } from '../types';

function removeHoverClasses(className = '') {
  return String(className).split(/\s+/u).filter((entry) => entry && !entry.startsWith('hover:')).join(' ');
}

const ThematicSummaryStories = ({ summaries = [], locale, readSummaryIds = [], t, onOpenSummary }: {
  summaries?: ThematicSummary[];
  locale: Locale;
  readSummaryIds?: string[];
  t: Translator;
  onOpenSummary: (summary: ThematicSummary) => void;
}) => {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return null;
  }

  const readSummaryIdSet = new Set(readSummaryIds);

  return (
    <section className="mb-6" aria-labelledby="daily-briefings-title">
      <h2 id="daily-briefings-title" className="mb-2 text-lg font-semibold text-ink-heading">{t('thematicSummariesTitle')}</h2>
      <div className="flex gap-3 overflow-x-auto p-1">
        {summaries.map((summary) => {
          const localizedSummary = getLocalizedThematicSummary(summary, locale);
          const primaryPresentation = getTopicPresentation(getThematicSummaryPresentationKey(summary));
          const circleClassName = removeHoverClasses(primaryPresentation.iconBadgeClassName);
          const PrimaryIcon = primaryPresentation.Icon;
          const unread = !readSummaryIdSet.has(summary.id);
          const ariaLabel = t('openThematicSummary', { topic: localizedSummary.displayTopicLabel });

          return (
            <button
              key={summary.id}
              type="button"
              onClick={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                onOpenSummary(summary);
              }}
              className="group inline-flex w-24 shrink-0 flex-col items-center gap-1.5 rounded-xl px-1 text-center focus-visible:ring-2 focus-visible:ring-sky-400"
              aria-label={summary.isStale ? `${ariaLabel} · ${t('summaryOutdated')}` : ariaLabel}
              title={summary.isStale ? t('summaryOutdated') : undefined}
            >
              <span className="relative inline-flex h-12 w-12 rounded-full p-[1.5px]" style={AI_ACCENT_GRADIENT_STYLE}>
                <span className={`inline-flex h-full w-full items-center justify-center rounded-full transition-[filter] group-hover:brightness-110 ${circleClassName}`}>
                  <PrimaryIcon className="h-5 w-5" aria-hidden="true" />
                </span>
                {unread && (
                  <span className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-surface bg-violet-600" aria-hidden="true" data-testid="thematic-summary-new-dot" />
                )}
              </span>
              <span className="max-w-full text-xs font-medium wrap-anywhere text-ink-body">
                {localizedSummary.displayTopicLabel}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};

export default ThematicSummaryStories;
