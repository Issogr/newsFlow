import { useRef } from 'react';
import { Search } from 'lucide-react';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import useFeedSearch from '../hooks/useFeedSearch';
import { FilterSearchInput } from './FilterSurfaceControls';
import { FeedFilterButton, type FeedFilterButtonProps } from './FeedNavControls';

export default function DesktopTopNavFilters({ search, t, onSearchChange, onSearchClear, onOpenSurface, closeSignal, ...filters }: FeedFilterButtonProps & {
  search: string;
  onSearchChange: (value: string) => void;
  onSearchClear: () => void;
  onOpenSurface: () => void;
  closeSignal: number;
}) {
  const searchRef = useRef<HTMLDivElement>(null);
  const { closeSearch, handleEnterSearch, handleExitSearch, searchButtonRef, searchInputRef, searchMode } = useFeedSearch({ onOpenSurface, onSearchClear, closeSignal });
  useOnClickOutside(searchRef, (event) => {
    // Collapsing on pointer down would move other toolbar buttons before the click lands.
    if (!(event.target instanceof Element && event.target.closest('header'))) closeSearch();
  });

  return (
    <div className="hidden items-center gap-2 md:flex">
      <div ref={searchRef} className="flex items-center">
        <button
          ref={searchButtonRef}
          type="button"
          onClick={handleEnterSearch}
          className={`feed-nav-button px-2 hover:bg-hover-soft lg:hidden ${search ? 'text-sky-700' : 'text-ink-muted'} ${searchMode ? 'hidden' : ''}`}
        >
          <Search className="h-4 w-4" aria-hidden="true" />{t('searchLabel')}
        </button>
        <FilterSearchInput
          className={`${searchMode ? 'flex' : 'hidden'} h-11 w-60 items-center gap-1 lg:flex xl:w-72`}
          cancelClassName="lg:hidden"
          onCancel={handleExitSearch}
          onSearchChange={onSearchChange}
          onSearchClear={onSearchClear}
          search={search}
          searchInputRef={searchInputRef}
          t={t}
        />
      </div>
      <FeedFilterButton {...filters} t={t} />
    </div>
  );
}
