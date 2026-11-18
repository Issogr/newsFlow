import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowUp } from 'lucide-react';
import useFeedSearch from '../hooks/useFeedSearch';
import { FilterSearchInput } from './FilterSurfaceControls';
import FilterNavActions from './FilterNavActions';
import type { Translator } from '../types';

const MOBILE_NAV_BUTTON_SIZE_CLASS_NAME = 'h-full min-w-0 rounded-none px-1';
const MOBILE_NAV_BADGE_SIZE_CLASS_NAME = 'h-3.5 w-3.5 px-0';

const MobileBottomNav = ({
  filterCount,
  filtersOpen,
  onOpenFilters,
  search,
  t,
  onRefresh,
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
}: {
  filterCount: number;
  filtersOpen: boolean;
  onOpenFilters: React.MouseEventHandler<HTMLButtonElement>;
  search: string;
  t: Translator;
  onRefresh?: () => void;
  onSearchChange: (value: string) => void;
  onSearchClear: () => void;
  activeView?: string;
  onViewChange?: (view: 'news' | 'readLater') => void;
  refreshActive?: boolean;
  refreshDisabled?: boolean;
  refreshTitle?: string;
  visible?: boolean;
  backToTopVisible?: boolean;
  onBackToTop?: () => void;
}) => {
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const { handleEnterSearch, handleExitSearch, searchInputRef, searchMode } = useFeedSearch({ onSearchClear });

  useEffect(() => {
    if (!searchMode || !window.visualViewport) {
      setKeyboardOffset(0);
      return undefined;
    }

    const viewport = window.visualViewport;
    const updateKeyboardOffset = () => {
      const nextOffset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardOffset(Math.round(nextOffset));
    };

    updateKeyboardOffset();
    viewport.addEventListener('resize', updateKeyboardOffset);
    viewport.addEventListener('scroll', updateKeyboardOffset);

    return () => {
      viewport.removeEventListener('resize', updateKeyboardOffset);
      viewport.removeEventListener('scroll', updateKeyboardOffset);
    };
  }, [searchMode]);

  const readLaterActive = activeView === 'readLater';
  const toolbarVisible = visible || searchMode;

  return (
    <div
      className="pointer-events-none fixed bottom-0 left-[env(safe-area-inset-left)] right-[env(safe-area-inset-right)] z-50 md:hidden"
      role="navigation"
    >
      <div
        className="relative mx-auto w-[calc(100%-2rem)] max-w-md pb-[calc(env(safe-area-inset-bottom)+1rem+var(--mobile-keyboard-offset,0px))] transition-[padding-bottom] duration-200 ease-out"
        style={{ '--mobile-keyboard-offset': `${keyboardOffset}px` } as CSSProperties}
      >
        {backToTopVisible && !searchMode && (
          <button
            type="button"
            onClick={onBackToTop}
            aria-label={t('backToTop')}
            className={`ui-icon-button pointer-events-auto absolute right-0 shadow-sm ${visible ? 'bottom-full mb-2' : 'bottom-[calc(1rem+env(safe-area-inset-bottom))]'}`}
          >
            <ArrowUp className="h-5 w-5 shrink-0" aria-hidden="true" />
          </button>
        )}
        <div
          className={`relative h-[3.95rem] overflow-hidden rounded-2xl border border-line bg-surface shadow-lg transition-transform duration-200 ease-out ${
            toolbarVisible ? 'pointer-events-auto' : 'translate-y-[calc(100%+1rem+env(safe-area-inset-bottom))]'
          }`}
          aria-hidden={!toolbarVisible}
          inert={toolbarVisible ? undefined : true}
        >
          <div
            className={`absolute inset-0 grid ${onRefresh ? 'grid-cols-4' : 'grid-cols-3'} transition-opacity duration-200 ease-out ${
              searchMode ? 'pointer-events-none opacity-0' : 'opacity-100'
            }`}
            aria-hidden={searchMode}
            inert={searchMode ? true : undefined}
          >
            <FilterNavActions
              filterCount={filterCount}
              filtersOpen={filtersOpen}
              onOpenFilters={onOpenFilters}
              badgeSizeClassName={MOBILE_NAV_BADGE_SIZE_CLASS_NAME}
              buttonSizeClassName={MOBILE_NAV_BUTTON_SIZE_CLASS_NAME}
              handleEnterSearch={handleEnterSearch}
              onRefresh={onRefresh}
              onReadLaterClick={() => onViewChange?.(readLaterActive ? 'news' : 'readLater')}
              readLaterActive={readLaterActive}
              readLaterBadge
              readLaterLabel={t('readLaterShort')}
              refreshActive={refreshActive}
              refreshAriaLabel={refreshTitle}
              refreshDisabled={refreshDisabled}
              refreshLabel={t('refresh')}
              refreshTitle={refreshTitle}
              search={search}
              searchActiveClassName="text-ink-heading"
              t={t}
            />
          </div>
          <div
            className={`absolute inset-0 flex items-center gap-2 px-2 py-1.5 transition-opacity duration-200 ease-out ${
              searchMode ? 'opacity-100' : 'pointer-events-none opacity-0'
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
  );
};

export default MobileBottomNav;
