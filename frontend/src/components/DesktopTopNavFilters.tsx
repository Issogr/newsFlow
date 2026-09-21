import { useOnClickOutside } from '../hooks/useOnClickOutside';
import useFilterSurfaceState from '../hooks/useFilterSurfaceState';
import { FilterSearchInput } from './FilterSurfaceControls';
import FilterBubbles from './FilterBubbles';
import FilterNavActions from './FilterNavActions';
import type { ActiveFilters, AvailableTopic, Locale, NewsSource, Translator } from '../types';

const TOP_BUBBLE_MAX_HEIGHT = 'min(55vh, 28rem)';

const DesktopTopNavFilters = ({
  visibleSources,
  availableTopics,
  activeFilters,
  search,
  t,
  locale,
  onClearFilter,
  onToggleFilter,
  onSearchChange,
  onSearchClear,
  onToggleReadLater,
  onOpenSurface,
  readLaterActive,
  closeSignal = 0,
  compact = false,
}: {
  visibleSources: NewsSource[];
  availableTopics: AvailableTopic[];
  activeFilters: ActiveFilters;
  search: string;
  t: Translator;
  locale: Locale;
  onClearFilter: (type: keyof ActiveFilters) => void;
  onToggleFilter: (type: keyof ActiveFilters, value: string) => void;
  onSearchChange: (value: string) => void;
  onSearchClear: () => void;
  onToggleReadLater: () => void;
  onOpenSurface?: () => void;
  readLaterActive: boolean;
  closeSignal?: number;
  compact?: boolean;
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

  const bubbleClassName = `ui-popover absolute right-0 ${compact ? 'top-[calc(100%+0.5rem)]' : 'top-[calc(100%+0.75rem)]'} z-50 w-[min(42rem,calc(100vw-3rem))]`;

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
        onClearFilter={onClearFilter}
        onToggleFilter={onToggleFilter}
        openBubble={openBubble}
        t={t}
        visibleSources={visibleSources}
      />

      {searchMode ? (
        <div className="flex items-center gap-1.5 transition-all duration-200 ease-out">
          <FilterSearchInput
            className="flex h-12 w-[clamp(14rem,36vw,30rem)] items-center gap-2"
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
          <FilterNavActions
            activeFilters={activeFilters}
            handleBubbleButtonClick={handleBubbleButtonClick}
            handleBubbleButtonPress={handleBubbleButtonPress}
            handleEnterSearch={handleEnterSearch}
            onReadLaterClick={onToggleReadLater}
            openBubble={openBubble}
            readLaterActive={readLaterActive}
            readLaterAriaLabel={t('readLater')}
            readLaterLabel={t('readLater')}
            readLaterTitle={t('readLater')}
            search={search}
            t={t}
          />
        </div>
      )}
    </div>
  );
};

export default DesktopTopNavFilters;
