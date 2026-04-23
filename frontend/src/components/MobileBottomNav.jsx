import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Clock3,
  Rss,
  Search,
  Tags,
  X,
} from 'lucide-react';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import { getTopicPresentation } from '../topicPresentation';
import { getLocalizedTopic } from '../i18n';

const BUBBLE_MAX_HEIGHT = 'min(50vh, 24rem)';

function FilterBubble({ children, open }) {
  return (
    <div
      className={`absolute bottom-full left-2 right-2 z-[60] mb-3 overflow-hidden rounded-[1.4rem] border border-slate-200/80 bg-white/95 shadow-[0_-8px_30px_rgba(15,23,42,0.12)] backdrop-blur-md transition-all duration-200 ease-out ${
        open
          ? 'pointer-events-auto translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-2 opacity-0'
      }`}
      aria-hidden={!open}
    >
      <div className="max-h-[var(--bubble-max-height)] overflow-y-auto overscroll-contain p-4" style={{ '--bubble-max-height': BUBBLE_MAX_HEIGHT }}>
        {children}
      </div>
    </div>
  );
}

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
  activeFiltersCount,
  visible = true,
}) => {
  const [openBubble, setOpenBubble] = useState(null);
  const [searchMode, setSearchMode] = useState(false);
  const searchInputRef = useRef(null);
  const navRef = useRef(null);
  const ignoreNextToggleClickRef = useRef(false);

  const closeAll = useCallback(() => {
    setOpenBubble(null);
  }, []);

  const handleToggleBubble = useCallback((name) => {
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
    setSearchMode(true);
    closeAll();
  }, [closeAll]);

  const handleExitSearch = useCallback(() => {
    setSearchMode(false);
    onSearchClear();
  }, [onSearchClear]);

  useOnClickOutside(navRef, () => {
    setOpenBubble(null);
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
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 md:hidden transition-transform duration-300 ease-out ${
        visible ? 'translate-y-0' : 'translate-y-full'
      }`}
    >
      {/* Bubbles + Nav wrapped together for outside-click detection */}
      <div ref={navRef} className="relative mx-auto w-[calc(100%-1.25rem)] max-w-md pb-2.5">
        <FilterBubble
          open={openBubble === 'sources'}
        >
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
        </FilterBubble>

        <FilterBubble
          open={openBubble === 'topics'}
        >
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
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      isActive
                        ? 'bg-slate-100 text-slate-700'
                        : 'bg-slate-50 text-slate-600'
                    }`}>
                      {topic.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </FilterBubble>

        {/* Nav bar */}
        <div className="overflow-hidden rounded-full border border-slate-200/80 bg-white/95 shadow-[0_10px_35px_rgba(15,23,42,0.18)] ring-1 ring-white/70 backdrop-blur-md">
        <div className="relative h-[3.95rem] overflow-hidden">
          <div
            className={`absolute inset-0 grid grid-cols-4 transition-all duration-300 ease-out ${
              searchMode
                ? 'pointer-events-none -translate-x-8 scale-95 opacity-0 blur-sm'
                : 'translate-x-0 scale-100 opacity-100 blur-0'
            }`}
          >
            <button
              type="button"
              onPointerDown={(event) => handleBubbleButtonPress(event, 'sources')}
              onClick={(event) => handleBubbleButtonClick(event, 'sources')}
              aria-expanded={openBubble === 'sources'}
              className={`relative flex h-full flex-col items-center justify-center gap-0.5 px-1 transition-colors ${
                openBubble === 'sources' ? 'text-sky-600' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <div className="relative flex h-5 w-5 items-center justify-center">
                <Rss className="h-5 w-5" />
                {sourceCount > 0 && (
                  <span className="absolute -right-1.5 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-sky-600 text-[8px] font-bold text-white">
                    {sourceCount}
                  </span>
                )}
              </div>
              <span className="h-3.5 text-center text-[10px] font-medium leading-none">{t('sources')}</span>
            </button>

            <button
              type="button"
              onPointerDown={(event) => handleBubbleButtonPress(event, 'topics')}
              onClick={(event) => handleBubbleButtonClick(event, 'topics')}
              aria-expanded={openBubble === 'topics'}
              className={`relative flex h-full flex-col items-center justify-center gap-0.5 px-1 transition-colors ${
                openBubble === 'topics' ? 'text-emerald-600' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <div className="relative flex h-5 w-5 items-center justify-center">
                <Tags className="h-5 w-5" />
                {topicCount > 0 && (
                  <span className="absolute -right-1.5 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-600 text-[8px] font-bold text-white">
                    {topicCount}
                  </span>
                )}
              </div>
              <span className="h-3.5 text-center text-[10px] font-medium leading-none">{t('topics')}</span>
            </button>

            <button
              type="button"
              onClick={onToggleRecent}
              className={`relative flex h-full flex-col items-center justify-center gap-0.5 px-1 transition-colors ${
                showRecentOnly ? 'text-amber-600' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <div className="relative flex h-5 w-5 items-center justify-center">
                <Clock3 className="h-5 w-5" />
                {timeCount > 0 && (
                  <span className="absolute -right-1.5 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-white" />
                )}
              </div>
              <span className="h-3.5 text-center text-[10px] font-medium leading-none">{t('latestHours', { hours: recentHours })}</span>
            </button>

            <button
              type="button"
              onClick={handleEnterSearch}
              className={`relative flex h-full flex-col items-center justify-center gap-0.5 px-1 transition-colors ${
                searchCount > 0 ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <div className="relative flex h-5 w-5 items-center justify-center">
                <Search className="h-5 w-5" />
                {searchCount > 0 && (
                  <span className="absolute -right-1.5 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-800 text-[8px] font-bold text-white" />
                )}
              </div>
              <span className="h-3.5 text-center text-[10px] font-medium leading-none">{t('searchLabel')}</span>
            </button>
          </div>

          <div
            className={`absolute inset-0 flex items-center gap-2 px-2 py-1.5 transition-all duration-300 ease-out ${
              searchMode
                ? 'translate-x-0 scale-100 opacity-100 blur-0'
                : 'pointer-events-none translate-x-8 scale-95 opacity-0 blur-sm'
            }`}
          >
            <label className="group flex h-full flex-1 items-center gap-2 rounded-full border border-slate-200/80 bg-gradient-to-r from-slate-50 to-white px-3.5 shadow-inner shadow-slate-200/60 transition-colors focus-within:border-sky-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-sky-100">
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
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
            <button
              type="button"
              onClick={handleExitSearch}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm transition-colors hover:bg-slate-700"
              aria-label={t('cancel')}
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};

export default MobileBottomNav;
