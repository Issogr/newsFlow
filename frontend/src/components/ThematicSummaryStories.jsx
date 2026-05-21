import React from 'react';
import { getTopicPresentation } from '../topicPresentation';
import { getLocalizedThematicSummary } from '../utils/thematicSummaryLocale';

function removeHoverClasses(className = '') {
  return String(className).split(/\s+/u).filter((entry) => entry && !entry.startsWith('hover:')).join(' ');
}

const ThematicSummaryStories = ({ summaries = [], locale, readSummaryIds = [], t, onOpenSummary }) => {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return null;
  }

  const readSummaryIdSet = new Set(readSummaryIds);

  return (
    <section className="mb-5" aria-label={t('thematicSummariesTitle')}>
      <div className="flex justify-center gap-3 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {summaries.map((summary) => {
          const localizedSummary = getLocalizedThematicSummary(summary, locale);
          const primaryPresentation = getTopicPresentation(summary.topics?.[0] || summary.topicLabel);
          const circleClassName = removeHoverClasses(primaryPresentation.iconBadgeClassName);
          const PrimaryIcon = primaryPresentation.Icon;
          const unread = !readSummaryIdSet.has(summary.id);

          return (
            <button
              key={summary.id}
              type="button"
              onClick={() => onOpenSummary(summary)}
              className="group relative inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-white shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
              aria-label={t('openThematicSummary', { topic: localizedSummary.displayTopicLabel })}
            >
              <span className={`inline-flex h-full w-full items-center justify-center rounded-full transition-[filter] group-hover:brightness-110 ${circleClassName}`}>
                <PrimaryIcon className="h-6 w-6" aria-hidden="true" />
              </span>
              {unread && (
                <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-slate-100 bg-sky-500" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
};

export default ThematicSummaryStories;
