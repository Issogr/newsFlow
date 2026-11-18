import { useRef } from 'react';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import useFeedSearch from '../hooks/useFeedSearch';
import { FilterSearchInput } from './FilterSurfaceControls';
import FilterNavActions from './FilterNavActions';
import type { Translator } from '../types';

const DesktopTopNavFilters = ({
  filterCount,
  filtersOpen,
  onOpenFilters,
  search,
  t,
  onSearchChange,
  onSearchClear,
  onToggleReadLater,
  onOpenSurface,
  readLaterActive,
  closeSignal = 0,
}: {
  filterCount: number;
  filtersOpen: boolean;
  onOpenFilters: React.MouseEventHandler<HTMLButtonElement>;
  search: string;
  t: Translator;
  onSearchChange: (value: string) => void;
  onSearchClear: () => void;
  onToggleReadLater: () => void;
  onOpenSurface?: () => void;
  readLaterActive: boolean;
  closeSignal?: number;
}) => {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const { closeSearch, handleEnterSearch, handleExitSearch, searchInputRef, searchMode } = useFeedSearch({ onOpenSurface, onSearchClear, closeSignal });
  useOnClickOutside(surfaceRef, closeSearch);

  return (
    <div ref={surfaceRef} className="relative hidden md:block">
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
            filterCount={filterCount}
            filtersOpen={filtersOpen}
            onOpenFilters={onOpenFilters}
            handleEnterSearch={handleEnterSearch}
            onReadLaterClick={onToggleReadLater}
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
