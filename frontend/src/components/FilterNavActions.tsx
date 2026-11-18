import {
  Bookmark,
  RefreshCw,
  SlidersHorizontal,
  Search,
} from 'lucide-react';
import TopNavActionButton from './TopNavActionButton';
import type { Translator } from '../types';

const FilterNavActions = ({
  filterCount,
  filtersOpen,
  badgeSizeClassName,
  buttonSizeClassName,
  onOpenFilters,
  handleEnterSearch,
  onRefresh,
  onReadLaterClick,
  readLaterActive,
  readLaterAriaLabel,
  readLaterBadge = false,
  readLaterLabel,
  readLaterTitle,
  refreshActive = false,
  refreshAriaLabel,
  refreshDisabled = false,
  refreshLabel,
  refreshTitle,
  search,
  searchActiveClassName,
  t,
}: {
  filterCount: number;
  filtersOpen: boolean;
  badgeSizeClassName?: string;
  buttonSizeClassName?: string;
  onOpenFilters: React.MouseEventHandler<HTMLButtonElement>;
  handleEnterSearch: () => void;
  onRefresh?: () => void;
  onReadLaterClick: () => void;
  readLaterActive: boolean;
  readLaterAriaLabel?: string;
  readLaterBadge?: boolean;
  readLaterLabel?: string;
  readLaterTitle?: string;
  refreshActive?: boolean;
  refreshAriaLabel?: string;
  refreshDisabled?: boolean;
  refreshLabel?: string;
  refreshTitle?: string;
  search: string;
  searchActiveClassName?: string;
  t: Translator;
}) => {
  const searchCount = search ? 1 : 0;

  return (
    <>
      <TopNavActionButton
        icon={SlidersHorizontal}
        label={t('feedFilters')}
        onClick={onOpenFilters}
        aria-haspopup="dialog"
        aria-expanded={filtersOpen}
        aria-controls="feed-filters"
        active={filtersOpen || filterCount > 0}
        activeClassName="text-sky-600"
        sizeClassName={buttonSizeClassName}
        badge={filterCount || null}
        badgeSizeClassName={badgeSizeClassName}
        badgeClassName="bg-sky-600 text-white"
      />

      {onRefresh ? (
        <TopNavActionButton
          icon={RefreshCw}
          label={refreshLabel}
          onClick={onRefresh}
          disabled={refreshDisabled}
          activeClassName="text-sky-600"
          sizeClassName={buttonSizeClassName}
          iconClassName={refreshActive ? 'animate-spin' : ''}
          aria-label={refreshAriaLabel}
          title={refreshTitle}
        />
      ) : null}

      <TopNavActionButton
        icon={Bookmark}
        label={readLaterLabel}
        onClick={onReadLaterClick}
        active={readLaterActive}
        aria-pressed={readLaterActive}
        activeClassName="text-amber-600"
        sizeClassName={buttonSizeClassName}
        badge={readLaterBadge && readLaterActive ? '' : null}
        badgeSizeClassName={badgeSizeClassName}
        badgeClassName="bg-amber-500 text-white"
        aria-label={readLaterAriaLabel}
        title={readLaterTitle}
      />

      <TopNavActionButton
        icon={Search}
        label={t('searchLabel')}
        onClick={handleEnterSearch}
        active={searchCount > 0}
        activeClassName={searchActiveClassName}
        sizeClassName={buttonSizeClassName}
        badge={searchCount > 0 ? '' : null}
        badgeSizeClassName={badgeSizeClassName}
        badgeClassName="bg-slate-800 text-white"
      />
    </>
  );
};

export default FilterNavActions;
