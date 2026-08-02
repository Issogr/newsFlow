import { X } from 'lucide-react';
import { FilterBubble } from './FilterSurfaceControls';
import { SourceFilterList, TopicFilterList } from './FilterOptionLists';
import type { ActiveFilters, AvailableTopic, Locale, NewsSource, Translator } from '../types';

const FilterHeader = ({ clearAriaLabel, clearClassName, count, onClear, title, t }: { clearAriaLabel: string; clearClassName: string; count: number; onClear: () => void; title: string; t: Translator }) => (
  <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
    <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
    {count > 0 && (
      <div className="flex shrink-0 items-center rounded-full bg-slate-100 p-1 pl-2 text-xs">
        <span
          className="min-w-4 text-center font-semibold text-slate-600"
          aria-label={t('selectedFilterCount', { count })}
          aria-live="polite"
        >
          {count}
        </span>
        <button
          type="button"
          onClick={onClear}
          aria-label={clearAriaLabel}
          title={clearAriaLabel}
          className={`ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/80 transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 ${clearClassName}`}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    )}
  </div>
);

const FilterBubbles = ({
  activeFilters,
  availableTopics,
  bubbleClassName,
  closedClassName,
  emptyLabel,
  locale,
  maxHeight,
  onClearFilter,
  onToggleFilter,
  openBubble,
  t,
  visibleSources,
}: {
  activeFilters: ActiveFilters;
  availableTopics: AvailableTopic[];
  bubbleClassName: string;
  closedClassName?: string;
  emptyLabel: string;
  locale: Locale;
  maxHeight: string;
  onClearFilter: (type: keyof ActiveFilters) => void;
  onToggleFilter: (type: keyof ActiveFilters, value: string) => void;
  openBubble: 'sources' | 'topics' | null;
  t: Translator;
  visibleSources: NewsSource[];
}) => (
  <>
    <FilterBubble
      open={openBubble === 'sources'}
      closedClassName={closedClassName}
      maxHeight={maxHeight}
      className={bubbleClassName}
    >
      {openBubble === 'sources' && (
        <>
          <FilterHeader
            clearAriaLabel={t('clearSourceFilters')}
            clearClassName="text-sky-700 hover:text-sky-900"
            count={activeFilters.sourceIds.length}
            onClear={() => onClearFilter('sourceIds')}
            title={t('filterBySource')}
            t={t}
          />
          <SourceFilterList
            sources={visibleSources}
            activeSourceIds={activeFilters.sourceIds}
            emptyLabel={emptyLabel}
            onToggleSource={(sourceId) => onToggleFilter('sourceIds', sourceId)}
          />
        </>
      )}
    </FilterBubble>

    <FilterBubble
      open={openBubble === 'topics'}
      closedClassName={closedClassName}
      maxHeight={maxHeight}
      className={bubbleClassName}
    >
      {openBubble === 'topics' && (
        <>
          <FilterHeader
            clearAriaLabel={t('clearTopicFilters')}
            clearClassName="text-emerald-700 hover:text-emerald-900"
            count={activeFilters.topics.length}
            onClear={() => onClearFilter('topics')}
            title={t('filterByTopic')}
            t={t}
          />
          <TopicFilterList
            topics={availableTopics}
            activeTopics={activeFilters.topics}
            emptyLabel={emptyLabel}
            locale={locale}
            onToggleTopic={(topic) => onToggleFilter('topics', topic)}
          />
        </>
      )}
    </FilterBubble>
  </>
);

export default FilterBubbles;
