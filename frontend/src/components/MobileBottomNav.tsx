import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowUp, Search } from 'lucide-react';
import useFeedSearch from '../hooks/useFeedSearch';
import { FilterSearchInput } from './FilterSurfaceControls';
import { FeedFilterButton, FeedViewButtons, type FeedFilterButtonProps, type FeedViewProps } from './FeedNavControls';

const MobileBottomNav = ({
  filterCount,
  filtersOpen,
  onOpenFilters,
  search,
  t,
  onSearchChange,
  onSearchClear,
  activeView,
  onViewChange,
  visible = true,
  backToTopVisible = false,
  onBackToTop,
}: FeedViewProps & FeedFilterButtonProps & {
  search: string;
  onSearchChange: (value: string) => void;
  onSearchClear: () => void;
  visible?: boolean;
  backToTopVisible?: boolean;
  onBackToTop?: () => void;
}) => {
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const { handleEnterSearch, handleExitSearch, searchButtonRef, searchInputRef, searchMode } = useFeedSearch({ onSearchClear });

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
            className={`absolute inset-0 grid grid-cols-4 gap-1 p-1 transition-opacity duration-200 ease-out ${
              searchMode ? 'pointer-events-none opacity-0' : 'opacity-100'
            }`}
            aria-hidden={searchMode}
            inert={searchMode ? true : undefined}
          >
            <FeedViewButtons activeView={activeView} onViewChange={onViewChange} t={t} />
            <FeedFilterButton
              filterCount={filterCount}
              filtersOpen={filtersOpen}
              onOpenFilters={onOpenFilters}
              t={t}
            />
            <button ref={searchButtonRef} type="button" onClick={handleEnterSearch} className={`feed-nav-button ${search ? 'text-sky-700' : 'text-ink-muted hover:bg-hover-soft'}`}>
              <Search className="h-5 w-5" aria-hidden="true" />{t('searchLabel')}
            </button>
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
