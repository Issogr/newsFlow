import {
  Bookmark,
  RefreshCw,
  Rss,
  Search,
  Tags,
} from 'lucide-react';
import TopNavActionButton from './TopNavActionButton';
import type { SyntheticEvent } from 'react';
import type { ActiveFilters, Translator } from '../types';

const FilterNavActions = ({
  activeFilters,
  badgeSizeClassName,
  buttonSizeClassName,
  handleBubbleButtonClick,
  handleBubbleButtonPress,
  handleEnterSearch,
  onRefresh,
  onReadLaterClick,
  openBubble,
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
  activeFilters: ActiveFilters;
  badgeSizeClassName?: string;
  buttonSizeClassName?: string;
  handleBubbleButtonClick: (event: SyntheticEvent, name: 'sources' | 'topics') => void;
  handleBubbleButtonPress: (event: SyntheticEvent, name: 'sources' | 'topics') => void;
  handleEnterSearch: () => void;
  onRefresh?: () => void;
  onReadLaterClick: () => void;
  openBubble: 'sources' | 'topics' | null;
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
  const sourceCount = activeFilters.sourceIds.length;
  const topicCount = activeFilters.topics.length;
  const searchCount = search ? 1 : 0;

  return (
    <>
      <TopNavActionButton
        icon={Rss}
        label={t('sources')}
        onPointerDown={(event) => handleBubbleButtonPress(event, 'sources')}
        onClick={(event) => handleBubbleButtonClick(event, 'sources')}
        aria-expanded={openBubble === 'sources'}
        active={openBubble === 'sources'}
        activeClassName="text-sky-600"
        sizeClassName={buttonSizeClassName}
        badge={sourceCount > 0 ? sourceCount : null}
        badgeSizeClassName={badgeSizeClassName}
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
        sizeClassName={buttonSizeClassName}
        badge={topicCount > 0 ? topicCount : null}
        badgeSizeClassName={badgeSizeClassName}
        badgeClassName="bg-emerald-600 text-white"
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
