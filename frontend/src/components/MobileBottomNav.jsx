import { useEffect, useState } from 'react';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import useFilterSurfaceState from '../hooks/useFilterSurfaceState';
import { FilterSearchInput } from './FilterSurfaceControls';
import FilterBubbles from './FilterBubbles';
import FilterNavActions from './FilterNavActions';

const BUBBLE_MAX_HEIGHT = 'min(50vh, 24rem)';
const MOBILE_BUBBLE_CLASS_NAME = 'absolute bottom-full left-2 right-2 z-[60] mb-3 overflow-hidden rounded-[1.4rem] border border-slate-200/80 bg-white/95 shadow-[0_-8px_30px_rgba(15,23,42,0.12)] backdrop-blur-md';

const MOBILE_NAV_BUTTON_SIZE_CLASS_NAME = 'h-full min-w-0 rounded-none px-1';
const MOBILE_NAV_BADGE_SIZE_CLASS_NAME = 'h-3.5 w-3.5 px-0';

const MobileBottomNav = ({
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
  activeView = 'news',
  onViewChange,
  visible = true,
}) => {
  const [keyboardOffset, setKeyboardOffset] = useState(0);
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
  } = useFilterSurfaceState({ onSearchClear });

  useOnClickOutside(surfaceRef, () => closeAll());

  useEffect(() => {
    if (!searchMode || !window.visualViewport) {
      setKeyboardOffset(0);
      return undefined;
    }

    const updateKeyboardOffset = () => {
      const viewport = window.visualViewport;
      const nextOffset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardOffset(Math.round(nextOffset));
    };

    updateKeyboardOffset();
    window.visualViewport.addEventListener('resize', updateKeyboardOffset);
    window.visualViewport.addEventListener('scroll', updateKeyboardOffset);

    return () => {
      window.visualViewport.removeEventListener('resize', updateKeyboardOffset);
      window.visualViewport.removeEventListener('scroll', updateKeyboardOffset);
      setKeyboardOffset(0);
    };
  }, [searchMode]);

  const readLaterActive = activeView === 'readLater';

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 md:hidden transition-transform duration-300 ease-out ${
        visible ? 'translate-y-0' : 'translate-y-full'
      }`}
    >
      {/* Bubbles + Nav wrapped together for outside-click detection */}
      <div
        ref={surfaceRef}
        className="relative mx-auto w-[calc(100%-2rem)] max-w-md pb-[calc(env(safe-area-inset-bottom)+1.25rem+var(--mobile-keyboard-offset,0px))] transition-[padding-bottom] duration-200 ease-out"
        style={{ '--mobile-keyboard-offset': `${keyboardOffset}px` }}
      >
        <FilterBubbles
          activeFilters={activeFilters}
          availableTopics={availableTopics}
          bubbleClassName={MOBILE_BUBBLE_CLASS_NAME}
          emptyLabel={t('noNewsText')}
          locale={locale}
          maxHeight={BUBBLE_MAX_HEIGHT}
          onToggleFilter={onToggleFilter}
          openBubble={openBubble}
          visibleSources={visibleSources}
        />

        {/* Nav bar */}
        <div className="overflow-hidden rounded-full border border-slate-200 bg-white/95 shadow-md backdrop-blur-md">
          <div className="relative h-[3.95rem] overflow-hidden">
          <div
            className={`absolute inset-0 grid grid-cols-5 transition-all duration-300 ease-out ${
              searchMode
                ? 'pointer-events-none -translate-x-8 scale-95 opacity-0 blur-sm'
                : 'translate-x-0 scale-100 opacity-100 blur-0'
            }`}
          >
            <FilterNavActions
              activeFilters={activeFilters}
              badgeSizeClassName={MOBILE_NAV_BADGE_SIZE_CLASS_NAME}
              buttonSizeClassName={MOBILE_NAV_BUTTON_SIZE_CLASS_NAME}
              handleBubbleButtonClick={handleBubbleButtonClick}
              handleBubbleButtonPress={handleBubbleButtonPress}
              handleEnterSearch={handleEnterSearch}
              onReadLaterClick={() => onViewChange?.(readLaterActive ? 'news' : 'readLater')}
              onToggleRecent={onToggleRecent}
              openBubble={openBubble}
              readLaterActive={readLaterActive}
              readLaterBadge
              readLaterLabel={t('readLaterShort')}
              recentHours={recentHours}
              search={search}
              searchActiveClassName="text-slate-900"
              showRecentOnly={showRecentOnly}
              t={t}
            />
          </div>

          <div
            className={`absolute inset-0 flex items-center gap-2 px-2 py-1.5 transition-all duration-300 ease-out ${
              searchMode
                ? 'translate-x-0 scale-100 opacity-100 blur-0'
                : 'pointer-events-none translate-x-8 scale-95 opacity-0 blur-sm'
            }`}
            aria-hidden={!searchMode}
            inert={searchMode ? undefined : ''}
          >
            <FilterSearchInput
              className="flex flex-1 items-center gap-2"
              labelClassName="h-full"
              inputTabIndex={searchMode ? 0 : -1}
              cancelIconClassName="h-4.5 w-4.5"
              onCancel={handleExitSearch}
              onSearchChange={onSearchChange}
              onSearchClear={onSearchClear}
              search={search}
              searchInputRef={searchInputRef}
              t={t}
            />
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};

export default MobileBottomNav;
