import React from 'react';
import { Sparkles } from 'lucide-react';
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
                <span
                  className="absolute -right-1 -top-1 inline-flex h-5 w-5 items-center justify-center rounded-full p-[1.5px] shadow-sm"
                  style={{ backgroundImage: 'conic-gradient(from 20deg, #f97316, #facc15, #22c55e, #06b6d4, #6366f1, #d946ef, #f97316)' }}
                  aria-hidden="true"
                >
                  <span className="inline-flex h-full w-full items-center justify-center rounded-full bg-white text-violet-700">
                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
};

export default ThematicSummaryStories;
