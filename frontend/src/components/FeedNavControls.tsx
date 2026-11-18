import { Bookmark, Newspaper, SlidersHorizontal } from 'lucide-react';
import type { Translator } from '../types';

export interface FeedViewProps {
  activeView: 'news' | 'readLater';
  onViewChange: (view: 'news' | 'readLater') => void;
  t: Translator;
}

export interface FeedFilterButtonProps {
  filterCount: number;
  filtersOpen: boolean;
  onOpenFilters: React.MouseEventHandler<HTMLButtonElement>;
  t: Translator;
}

export function FeedViewButtons({ activeView, onViewChange, t }: FeedViewProps) {
  return (['news', 'readLater'] as const).map((view) => {
    const selected = activeView === view;
    const Icon = view === 'news' ? Newspaper : Bookmark;
    return (
      <button
        key={view}
        type="button"
        aria-pressed={selected}
        onClick={() => onViewChange(view)}
        className={`feed-nav-button md:px-2.5 lg:px-3 ${
          selected ? 'bg-sky-50 font-semibold text-sky-800 md:bg-surface md:text-ink-heading md:shadow-sm' : 'text-ink-muted hover:bg-hover-soft'
        }`}
      >
        <Icon className="h-5 w-5 md:hidden lg:block lg:h-4 lg:w-4" aria-hidden="true" />
        {t(view === 'news' ? 'latestShort' : 'readLaterShort')}
      </button>
    );
  });
}

export function FeedFilterButton({ filterCount, filtersOpen, onOpenFilters, t }: FeedFilterButtonProps) {
  return (
    <button
      type="button"
      onClick={onOpenFilters}
      aria-haspopup="dialog"
      aria-expanded={filtersOpen}
      aria-controls="feed-filters"
      className={`feed-nav-button md:border md:border-line md:px-3 ${
        filtersOpen || filterCount ? 'bg-sky-50 text-sky-800' : 'text-ink-muted hover:bg-hover-soft'
      }`}
    >
      <span className="relative md:contents">
        <SlidersHorizontal className="h-5 w-5 md:h-4 md:w-4" aria-hidden="true" />
        {filterCount > 0 && (
          <span className="absolute -top-2 -right-2.5 min-w-4 rounded-full bg-sky-700 px-1 text-center text-[10px] leading-4 font-semibold text-white md:static md:order-last">
            {filterCount}
          </span>
        )}
      </span>
      {t('feedFilters')}
    </button>
  );
}
