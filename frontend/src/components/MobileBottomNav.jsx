import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import useFilterSurfaceState from '../hooks/useFilterSurfaceState';
import { FilterSearchInput } from './FilterSurfaceControls';
import FilterBubbles from './FilterBubbles';
import FilterNavActions from './FilterNavActions';

const BUBBLE_MAX_HEIGHT = 'min(50vh, 24rem)';
const MOBILE_BUBBLE_CLASS_NAME = 'absolute bottom-full left-2 right-2 z-[60] mb-3 overflow-hidden rounded-[1.6rem] border border-slate-200/80 bg-white/95 shadow-[0_16px_40px_-20px_rgba(14,165,233,0.45)] backdrop-blur-xl';

const MOBILE_NAV_BUTTON_SIZE_CLASS_NAME = 'h-full min-w-0 rounded-none px-1';
const MOBILE_NAV_BADGE_SIZE_CLASS_NAME = 'h-3.5 w-3.5 px-0';

const MobileBottomNav = ({
  visibleSources,
  availableTopics,
  activeFilters,
  search,
  t,
  locale,
  onRefresh,
  onClearFilter,
  onToggleFilter,
  onSearchChange,
  onSearchClear,
  activeView = 'news',
  onViewChange,
  refreshActive = false,
  refreshDisabled = false,
  refreshTitle,
  visible = true,
  backToTopVisible = false,
  onBackToTop,
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
    };
  }, [searchMode]);

  const readLaterActive = activeView === 'readLater';
  const surfaceVisible = visible || backToTopVisible;

  return (
    <div
      className={`fixed bottom-0 left-[env(safe-area-inset-left)] right-[env(safe-area-inset-right)] z-50 transition-transform duration-500 ease-out md:hidden ${
        surfaceVisible ? 'translate-y-0' : 'translate-y-full'
      }`}
      role="navigation"
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
          onClearFilter={onClearFilter}
          onToggleFilter={onToggleFilter}
          openBubble={openBubble}
          t={t}
          visibleSources={visibleSources}
        />

        <div className="flex items-end">
          <button
            type="button"
            onClick={onBackToTop}
            disabled={!backToTopVisible}
            tabIndex={backToTopVisible ? 0 : -1}
            aria-hidden={!backToTopVisible}
            aria-label={t('backToTop')}
            className={`relative z-10 inline-flex h-[3.95rem] min-w-0 shrink-0 items-center justify-center overflow-hidden rounded-[1.6rem] border border-slate-200/80 bg-white/95 text-slate-700 shadow-[0_16px_40px_-20px_rgba(14,165,233,0.45)] backdrop-blur-xl transition-[width,margin,transform,opacity] duration-500 ease-out hover:bg-white hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 ${
              backToTopVisible
                ? 'mr-2 w-[3.95rem] translate-x-0 scale-100 opacity-100'
                : 'pointer-events-none mr-0 w-0 -translate-x-3 scale-75 opacity-0'
            }`}
          >
            <ArrowUp className="h-5 w-5 shrink-0" aria-hidden="true" />
          </button>

          <div
            className={`mobile-nav-liquid relative min-w-0 ${backToTopVisible ? 'mobile-nav-liquid-with-button' : 'mobile-nav-liquid-full'} ${
              visible
                ? 'mobile-nav-liquid-visible'
                : 'mobile-nav-liquid-hidden'
            }`}
            aria-hidden={!visible}
            inert={visible ? undefined : true}
          >
            <div className="overflow-hidden rounded-[1.6rem] border border-slate-200/80 bg-white/95 shadow-[0_16px_40px_-20px_rgba(14,165,233,0.45)] backdrop-blur-xl">
              <div className="relative h-[3.95rem] overflow-hidden">
                <div
                  className={`absolute inset-0 grid ${onRefresh ? 'grid-cols-5' : 'grid-cols-4'} transition-all duration-300 ease-out ${
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
                    onRefresh={onRefresh}
                    onReadLaterClick={() => onViewChange?.(readLaterActive ? 'news' : 'readLater')}
                    openBubble={openBubble}
                    readLaterActive={readLaterActive}
                    readLaterBadge
                    readLaterLabel={t('readLaterShort')}
                    refreshActive={refreshActive}
                    refreshAriaLabel={refreshTitle}
                    refreshDisabled={refreshDisabled}
                    refreshLabel={t('refresh')}
                    refreshTitle={refreshTitle}
                    search={search}
                    searchActiveClassName="text-slate-900"
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
                  inert={searchMode ? undefined : true}
                >
                  <FilterSearchInput
                    className="flex h-full min-w-0 flex-1 items-center gap-2"
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
      </div>
    </div>
  );
};

export default MobileBottomNav;
