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
    <section className="mb-6 border-b border-slate-200 pb-5" aria-label={t('thematicSummariesTitle')}>
      <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('thematicSummariesTitle')}</h2>
      <div className="flex gap-4 overflow-x-auto px-1 py-1">
        {summaries.map((summary) => {
          const localizedSummary = getLocalizedThematicSummary(summary, locale);
          const primaryPresentation = getTopicPresentation(getThematicSummaryPresentationKey(summary));
          const circleClassName = removeHoverClasses(primaryPresentation.iconBadgeClassName);
          const PrimaryIcon = primaryPresentation.Icon;
          const unread = !readSummaryIdSet.has(summary.id);
          const ariaLabel = t('openThematicSummary', { topic: localizedSummary.displayTopicLabel });

          return (
            <div key={summary.id} className="flex w-20 shrink-0 flex-col items-center gap-2">
              <button
                type="button"
                onClick={(event) => {
                  event.currentTarget.focus({ preventScroll: true });
                  onOpenSummary(summary);
                }}
                className="group relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full p-[1.5px] focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
                style={AI_ACCENT_GRADIENT_STYLE}
                aria-label={summary.isStale ? `${ariaLabel} · ${t('summaryOutdated')}` : ariaLabel}
                title={summary.isStale ? t('summaryOutdated') : undefined}
              >
                <span className={`inline-flex h-full w-full items-center justify-center rounded-full transition-[filter] group-hover:brightness-110 ${circleClassName}`}>
                  <PrimaryIcon className="h-5 w-5" aria-hidden="true" />
                </span>
                {unread && (
                  <span
                    className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-white bg-violet-600 shadow-sm"
                    aria-hidden="true"
                    data-testid="thematic-summary-new-dot"
                  />
                )}
              </button>
              <span className="w-full truncate text-center text-xs font-medium text-slate-600" title={localizedSummary.displayTopicLabel}>{localizedSummary.displayTopicLabel}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default ThematicSummaryStories;
