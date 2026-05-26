import React from 'react';
import {
  Bookmark,
  Clock3,
  Rss,
  Search,
  Tags,
} from 'lucide-react';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import useFilterSurfaceState from '../hooks/useFilterSurfaceState';
import { FilterSearchInput } from './FilterSurfaceControls';
import TopNavActionButton from './TopNavActionButton';
import FilterBubbles from './FilterBubbles';

const TOP_BUBBLE_MAX_HEIGHT = 'min(55vh, 28rem)';

const DesktopTopNavFilters = ({
  visibleSources,
  availableTopics,
  activeFilters,
  showRecentOnly,
  search,
  recentHours,
  t,
  locale,
  onToggleFilter,
  onToggleRecent,
  onSearchChange,
  onSearchClear,
  onToggleReadLater,
  onOpenSurface,
  readLaterActive,
  closeSignal = 0,
  compact = false,
}) => {
  const {
    closeAll,
    handleBubbleButtonClick,
    handleBubbleButtonPress,
    handleEnterSearch,
    handleExitSearch,
    openBubble,
    searchInputRef,
    searchMode,
    surfaceRef,
  } = useFilterSurfaceState({ onOpenSurface, onSearchClear, closeSignal });

  useOnClickOutside(surfaceRef, () => closeAll({ closeSearch: true }));

  const sourceCount = activeFilters.sourceIds.length;
  const topicCount = activeFilters.topics.length;
  const timeCount = showRecentOnly ? 1 : 0;
  const searchCount = search ? 1 : 0;
  const bubbleClassName = `absolute right-0 ${compact ? 'top-[calc(100%+1rem)]' : 'top-[calc(100%+1.625rem)]'} z-50 w-[min(42rem,calc(100vw-3rem))] overflow-hidden rounded-[1.4rem] border border-slate-200/80 bg-white/95 shadow-2xl backdrop-blur-md`;

  return (
    <div ref={surfaceRef} className="relative hidden md:block">
      <FilterBubbles
        activeFilters={activeFilters}
        availableTopics={availableTopics}
        bubbleClassName={bubbleClassName}
        closedClassName="-translate-y-2"
        emptyLabel={t('noNewsText')}
        locale={locale}
        maxHeight={TOP_BUBBLE_MAX_HEIGHT}
        onToggleFilter={onToggleFilter}
        openBubble={openBubble}
        visibleSources={visibleSources}
      />

      {searchMode ? (
        <div className="flex items-center gap-1.5 transition-all duration-200 ease-out">
          <TopNavActionButton
            icon={Bookmark}
            label={t('readLater')}
            onClick={onToggleReadLater}
            active={readLaterActive}
            activeClassName="text-amber-600"
            aria-label={t('readLater')}
            title={t('readLater')}
          />
          <FilterSearchInput
            className="flex w-[min(32vw,25rem)] items-center gap-2"
            cancelIconClassName="h-[1.125rem] w-[1.125rem]"
            onCancel={handleExitSearch}
            onSearchChange={onSearchChange}
            onSearchClear={onSearchClear}
            search={search}
            searchInputRef={searchInputRef}
            t={t}
          />
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <TopNavActionButton
            icon={Rss}
            label={t('sources')}
            onPointerDown={(event) => handleBubbleButtonPress(event, 'sources')}
            onClick={(event) => handleBubbleButtonClick(event, 'sources')}
            aria-expanded={openBubble === 'sources'}
            active={openBubble === 'sources'}
            activeClassName="text-sky-600"
            badge={sourceCount > 0 ? sourceCount : null}
            badgeClassName="bg-sky-600 text-white"
          />

          <TopNavActionButton
            icon={Tags}
            label={t('topics')}
            onPointerDown={(event) => handleBubbleButtonPress(event, 'topics')}
            onClick={(event) => handleBubbleButtonClick(event, 'topics')}
            aria-expanded={openBubble === 'topics'}
            active={openBubble === 'topics'}
            activeClassName="text-emerald-600"
            badge={topicCount > 0 ? topicCount : null}
            badgeClassName="bg-emerald-600 text-white"
          />

          <TopNavActionButton
            icon={Clock3}
            label={t('latestHours', { hours: recentHours })}
            onClick={onToggleRecent}
            active={showRecentOnly}
            activeClassName="text-amber-600"
            minWidthClassName="min-w-16"
            badge={timeCount > 0 ? '' : null}
            badgeClassName="bg-amber-500 text-white"
            labelClassName="whitespace-nowrap"
          />

          <TopNavActionButton
            icon={Bookmark}
            label={t('readLater')}
            onClick={onToggleReadLater}
            active={readLaterActive}
            activeClassName="text-amber-600"
            aria-label={t('readLater')}
            title={t('readLater')}
          />

          <TopNavActionButton
            icon={Search}
            label={t('searchLabel')}
            onClick={handleEnterSearch}
            active={searchCount > 0}
            badge={searchCount > 0 ? '' : null}
            badgeClassName="bg-slate-800 text-white"
          />
        </div>
      )}
    </div>
  );
};

export default DesktopTopNavFilters;
