import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Clock3,
  Rss,
  Search,
  Tags,
  X,
} from 'lucide-react';
import { getLocalizedTopic } from '../i18n';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import { getTopicPresentation } from '../topicPresentation';
import TopNavActionButton from './TopNavActionButton';

const TOP_BUBBLE_MAX_HEIGHT = 'min(55vh, 28rem)';

function TopFilterBubble({ children, open }) {
  return (
    <div
      className={`absolute right-0 top-full z-50 mt-3 w-[min(42rem,calc(100vw-3rem))] overflow-hidden rounded-[1.4rem] border border-slate-200/80 bg-white/95 shadow-2xl backdrop-blur-md transition-all duration-200 ease-out ${
        open
          ? 'pointer-events-auto translate-y-0 opacity-100'
          : 'pointer-events-none -translate-y-2 opacity-0'
      }`}
      aria-hidden={!open}
    >
      <div className="max-h-[var(--top-bubble-max-height)] overflow-y-auto overscroll-contain p-4" style={{ '--top-bubble-max-height': TOP_BUBBLE_MAX_HEIGHT }}>
        {children}
      </div>
    </div>
  );
}

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
}) => {
  const [openBubble, setOpenBubble] = useState(null);
  const [searchMode, setSearchMode] = useState(false);
  const searchInputRef = useRef(null);
  const wrapperRef = useRef(null);
  const ignoreNextToggleClickRef = useRef(false);

  const closeBubbles = useCallback(() => setOpenBubble(null), []);

  const handleToggleBubble = useCallback((name) => {
    setSearchMode(false);
    setOpenBubble((current) => (current === name ? null : name));
  }, []);

  const handleBubbleButtonPress = useCallback((event, name) => {
    event.preventDefault();
    event.stopPropagation();
    ignoreNextToggleClickRef.current = true;
    handleToggleBubble(name);
  }, [handleToggleBubble]);

  const handleBubbleButtonClick = useCallback((event, name) => {
    event.stopPropagation();
    if (ignoreNextToggleClickRef.current) {
      ignoreNextToggleClickRef.current = false;
      return;
    }

    handleToggleBubble(name);
  }, [handleToggleBubble]);

  const handleEnterSearch = useCallback(() => {
    closeBubbles();
    setSearchMode(true);
  }, [closeBubbles]);

  const handleExitSearch = useCallback(() => {
    setSearchMode(false);
    onSearchClear();
  }, [onSearchClear]);

  useOnClickOutside(wrapperRef, () => {
    closeBubbles();
    setSearchMode(false);
  });

  useEffect(() => {
    if (searchMode && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchMode]);

  useEffect(() => {
    if (!openBubble) {
      return undefined;
    }

    const handleScroll = () => setOpenBubble(null);
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => window.removeEventListener('scroll', handleScroll);
  }, [openBubble]);

  const sourceCount = activeFilters.sourceIds.length;
  const topicCount = activeFilters.topics.length;
  const timeCount = showRecentOnly ? 1 : 0;
  const searchCount = search ? 1 : 0;

  return (
    <div ref={wrapperRef} className="relative hidden md:block">
      <TopFilterBubble open={openBubble === 'sources'}>
        {visibleSources.length === 0 ? (
          <p className="text-sm text-slate-500">{t('noNewsText')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {visibleSources.map((source) => {
              const isActive = activeFilters.sourceIds.includes(source.id);
              return (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => onToggleFilter('sourceIds', source.id)}
                  className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'bg-sky-100 text-sky-900 hover:bg-sky-200'
                  }`}
                >
                  <span>{source.name}</span>
                  {source.count > 0 && (
                    <span className={`rounded-full px-2 py-0.5 text-xs ${isActive ? 'bg-white/20 text-white' : 'bg-white/80 text-sky-700'}`}>
                      {source.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </TopFilterBubble>

      <TopFilterBubble open={openBubble === 'topics'}>
        {availableTopics.length === 0 ? (
          <p className="text-sm text-slate-500">{t('noNewsText')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {availableTopics.map((topic) => {
              const isActive = activeFilters.topics.includes(topic.topic);
              const { Icon, iconBadgeClassName } = getTopicPresentation(topic.topic);
              return (
                <button
                  key={topic.topic}
                  type="button"
                  onClick={() => onToggleFilter('topics', topic.topic)}
                  className={`inline-flex items-center gap-1.5 rounded-full border pl-1 pr-3 py-1 text-sm font-medium transition-colors ${
                    isActive
                      ? 'border-slate-900 bg-white text-slate-950 shadow-sm'
                      : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'
                  }`}
                >
                  <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors ${iconBadgeClassName}`}>
                    <Icon className="h-3 w-3" aria-hidden="true" />
                  </span>
                  <span>{getLocalizedTopic(topic.topic, locale)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${isActive ? 'bg-slate-100 text-slate-700' : 'bg-slate-50 text-slate-600'}`}>
                    {topic.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </TopFilterBubble>

      {searchMode ? (
        <div className="flex w-[min(32vw,25rem)] items-center gap-2 transition-all duration-200 ease-out">
          <label className="group flex h-11 flex-1 items-center gap-2 rounded-full border border-slate-200/80 bg-gradient-to-r from-slate-50 to-white px-3.5 shadow-inner shadow-slate-200/60 transition-colors focus-within:border-sky-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-sky-100">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm transition-colors group-focus-within:text-sky-600">
              <Search className="h-4 w-4" aria-hidden="true" />
            </span>
            <input
              ref={searchInputRef}
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={t('searchPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-800 outline-none placeholder:font-normal placeholder:text-slate-400"
            />
            {search && (
              <button
                type="button"
                onClick={onSearchClear}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
                aria-label={t('clearSearch')}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </label>
          <button
            type="button"
            onClick={handleExitSearch}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm transition-colors hover:bg-slate-700"
            aria-label={t('cancel')}
          >
            <X className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
          </button>
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
