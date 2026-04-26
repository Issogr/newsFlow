import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Cog,
  LogOut,
  MessageSquare,
  PauseCircle,
  RefreshCw,
  User,
  WifiOff,
} from 'lucide-react';
import { fetchNews, isRequestCanceled } from '../services/api';
import ErrorMessage from './ErrorMessage';
import NewsCard from './NewsCard';
import ReaderPanel from './ReaderPanel';
import BrandMark from './BrandMark';
import FeedbackModal from './FeedbackModal';
import SettingsPanel from './SettingsPanel';
import useLatestRequest from '../hooks/useLatestRequest';
import useWebSocket from '../hooks/useWebSocket';
import { createTranslator, LOCALE_STORAGE_KEY, resolvePreferredLocale } from '../i18n';
import { getSettingsLimits } from '../config/settingsLimits';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import { setStoredReaderTextSizePreference } from '../utils/readerTextSizePreference';
import MobileBottomNav from './MobileBottomNav';
import DesktopTopNavFilters from './DesktopTopNavFilters';
import TopNavActionButton from './TopNavActionButton';

const PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 350;
const EMPTY_FILTERS = { sourceIds: [], topics: [] };
const BACK_TO_TOP_THRESHOLD = 280;
const TOP_NAV_SHRINK_THRESHOLD = 28;
const COMPACT_CARD_DESKTOP_QUERY = '(min-width: 768px)';

function resolveCompactNewsCardsEnabled(mode, isDesktop) {
  switch (mode) {
    case 'mobile':
      return !isDesktop;
    case 'desktop':
      return isDesktop;
    case 'everywhere':
      return true;
    default:
      return false;
  }
}

const mergeGroups = (primaryGroups, secondaryGroups) => {
  const merged = new Map();

  [...primaryGroups, ...secondaryGroups].forEach((group) => {
    if (group?.id && !merged.has(group.id)) {
      merged.set(group.id, group);
    }
  });

  return [...merged.values()];
};

const mergeUniqueGroups = (currentGroups, incomingGroups) => mergeGroups(incomingGroups, currentGroups);

const appendUniqueGroups = (currentGroups, incomingGroups) => mergeGroups(currentGroups, incomingGroups);

const getSourceReloadSignature = (excludedSourceIds, excludedSubSourceIds, customSources) => JSON.stringify({
  excludedSourceIds,
  excludedSubSourceIds,
  customSources: (customSources || []).map((source) => [source.id, source.url])
});

const NewsAggregator = ({ currentUser, onLogout, onUserUpdate, currentChangelogVersion, onOpenReleaseNotes }) => {
  const preferredLanguage = currentUser?.settings?.defaultLanguage;
  const autoRefreshEnabled = currentUser?.settings?.autoRefreshEnabled !== false;
  const showNewsImages = currentUser?.settings?.showNewsImages !== false;
  const compactNewsCardsMode = currentUser?.settings?.compactNewsCardsMode
    || (currentUser?.settings?.compactNewsCards ? 'everywhere' : 'off');
  const [isDesktopViewport, setIsDesktopViewport] = useState(() => {
    if (typeof window.matchMedia !== 'function') {
      return true;
    }

    return window.matchMedia(COMPACT_CARD_DESKTOP_QUERY).matches;
  });
  const compactNewsCards = resolveCompactNewsCardsEnabled(compactNewsCardsMode, isDesktopViewport);
  const [locale, setLocale] = useState(() => resolvePreferredLocale(preferredLanguage));
  const t = useMemo(() => createTranslator(locale), [locale]);
  const settingsLimits = useMemo(() => getSettingsLimits(currentUser), [currentUser]);
  const {
    isConnected,
    lastNewsUpdate,
    updateSubscriptionFilters,
    resetNewArticlesCount,
    markGroupsSeen
  } = useWebSocket('', {}, autoRefreshEnabled);
  const liveStatusLabel = autoRefreshEnabled
    ? (isConnected ? t('liveActive') : t('liveOffline'))
    : t('liveDisabled');
  const lastNewsUpdateRef = useRef(null);
  const scrollFrameRef = useRef(null);
  const { startLatestRequest: startListRequest } = useLatestRequest();
  const { startLatestRequest: startPaginationRequest, cancelLatestRequest: cancelPaginationRequest } = useLatestRequest();

  const [news, setNews] = useState([]);
  const [meta, setMeta] = useState(null);
  const [availableSources, setAvailableSources] = useState([]);
  const [sourceCatalog, setSourceCatalog] = useState([]);
  const [availableTopics, setAvailableTopics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState(EMPTY_FILTERS);
  const [showRecentOnly, setShowRecentOnly] = useState(false);
  const [readerState, setReaderState] = useState({ isOpen: false, group: null, articleId: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [desktopFiltersCloseSignal, setDesktopFiltersCloseSignal] = useState(0);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(true);
  const [topNavCompact, setTopNavCompact] = useState(false);
  const lastScrollY = useRef(0);
  const userMenuRef = useRef(null);
  const visibleGroupIds = useMemo(() => news.map((group) => group?.id).filter(Boolean), [news]);
  const recentHours = Math.max(
    settingsLimits.recentHours.min,
    Math.min(Number(currentUser?.settings?.recentHours) || settingsLimits.recentHours.max, settingsLimits.recentHours.max)
  );
  const excludedSourceIds = useMemo(() => currentUser?.settings?.excludedSourceIds || [], [currentUser?.settings?.excludedSourceIds]);
  const excludedSubSourceIds = useMemo(() => currentUser?.settings?.excludedSubSourceIds || [], [currentUser?.settings?.excludedSubSourceIds]);
  const sourceReloadSignature = useMemo(() => {
    return getSourceReloadSignature(excludedSourceIds, excludedSubSourceIds, currentUser?.customSources || []);
  }, [currentUser?.customSources, excludedSourceIds, excludedSubSourceIds]);
  const sourceReloadSignatureRef = useRef(sourceReloadSignature);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(COMPACT_CARD_DESKTOP_QUERY);
    const handleChange = (event) => {
      setIsDesktopViewport(event.matches);
    };

    setIsDesktopViewport(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);
  const visibleAvailableSources = useMemo(() => {
    return availableSources.filter((source) => !excludedSourceIds.includes(source.id));
  }, [availableSources, excludedSourceIds]);
  const isLiveAutoRefreshWorking = autoRefreshEnabled && isConnected && !debouncedSearch && !showRecentOnly;
  const refreshButtonLabel = isLiveAutoRefreshWorking ? t('refreshHandledByLive') : t('refresh');

  useOnClickOutside(userMenuRef, () => setUserMenuOpen(false));

  useEffect(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    setLocale(resolvePreferredLocale(preferredLanguage));
  }, [preferredLanguage]);

  useEffect(() => {
    setStoredReaderTextSizePreference(currentUser?.settings?.readerTextSize || 'medium');
  }, [currentUser?.settings?.readerTextSize]);

  useEffect(() => {
    const handleScroll = () => {
      if (scrollFrameRef.current) {
        return;
      }

      scrollFrameRef.current = window.requestAnimationFrame(() => {
        const currentY = window.scrollY;
        const nextShowBackToTop = currentY > BACK_TO_TOP_THRESHOLD;
        const nextTopNavCompact = currentY > TOP_NAV_SHRINK_THRESHOLD;
        const nextShowMobileNav = !(currentY > lastScrollY.current && currentY > 50);

        setShowBackToTop((current) => (current === nextShowBackToTop ? current : nextShowBackToTop));
        setTopNavCompact((current) => (current === nextTopNavCompact ? current : nextTopNavCompact));
        setUserMenuOpen((current) => (current ? false : current));
        setShowMobileNav((current) => (current === nextShowMobileNav ? current : nextShowMobileNav));
        lastScrollY.current = currentY;
        scrollFrameRef.current = null;
      });
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (scrollFrameRef.current) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setActiveFilters((current) => ({
      ...current,
      sourceIds: current.sourceIds.filter((sourceId) => !excludedSourceIds.includes(sourceId))
    }));
  }, [excludedSourceIds]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [search]);

  const loadNews = useCallback(async ({ page = 1, append = false, resetRealtime = true, cursor = null } = {}) => {
    const setBusyState = append ? setLoadingMore : setLoading;
    const request = append ? startPaginationRequest() : startListRequest();

    if (!append) {
      cancelPaginationRequest();
      setLoadingMore(false);
    }

    setBusyState(true);
    setError(null);

    try {
      const response = await fetchNews({
        page,
        pageSize: PAGE_SIZE,
        search: debouncedSearch,
        sourceIds: activeFilters.sourceIds,
        topics: activeFilters.topics,
        recentHours: showRecentOnly ? recentHours : null,
        beforePubDate: append ? cursor?.beforePubDate : '',
        beforeId: append ? cursor?.beforeId : '',
        includeFilters: !append,
        signal: request.signal
      });

      if (!request.isLatest()) {
        return;
      }

      setNews((current) => append ? appendUniqueGroups(current, response.items || []) : (response.items || []));
      setMeta(response.meta || null);
      if (response.filters) {
        setAvailableSources(response.filters.sources || []);
        setSourceCatalog(response.filters.sourceCatalog || []);
        setAvailableTopics(response.filters.topics || []);
      }

      if (resetRealtime) {
        resetNewArticlesCount();
      }
    } catch (requestError) {
      if (!isRequestCanceled(requestError) && request.isLatest()) {
        setError(requestError);
      }
    } finally {
      if (request.isLatest()) {
        setBusyState(false);
      }
    }
  }, [activeFilters.sourceIds, activeFilters.topics, cancelPaginationRequest, debouncedSearch, recentHours, resetNewArticlesCount, showRecentOnly, startListRequest, startPaginationRequest]);

  useEffect(() => {
    if (sourceReloadSignature === sourceReloadSignatureRef.current) {
      return;
    }

    sourceReloadSignatureRef.current = sourceReloadSignature;
    loadNews({ page: 1, append: false, resetRealtime: false });
  }, [loadNews, sourceReloadSignature]);

  useEffect(() => {
    loadNews({ page: 1, append: false, resetRealtime: false });
  }, [loadNews]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }

    updateSubscriptionFilters({
      topics: activeFilters.topics,
      sourceIds: activeFilters.sourceIds,
      excludedSourceIds,
      excludedSubSourceIds
    });
  }, [activeFilters.sourceIds, activeFilters.topics, excludedSourceIds, excludedSubSourceIds, isConnected, updateSubscriptionFilters]);

  useEffect(() => {
    if (visibleGroupIds.length === 0) {
      return;
    }

    markGroupsSeen(visibleGroupIds);
  }, [lastNewsUpdate?.timestamp, markGroupsSeen, visibleGroupIds]);

  useEffect(() => {
    if (!lastNewsUpdate?.timestamp || lastNewsUpdate.timestamp === lastNewsUpdateRef.current) {
      return;
    }

    lastNewsUpdateRef.current = lastNewsUpdate.timestamp;

    if (!isLiveAutoRefreshWorking) {
      return;
    }

    if (lastNewsUpdate.refresh) {
      loadNews({ page: 1, append: false, resetRealtime: false });
      return;
    }

    if (Array.isArray(lastNewsUpdate.data) && lastNewsUpdate.data.length > 0) {
      setNews((current) => mergeUniqueGroups(current, lastNewsUpdate.data));
      resetNewArticlesCount();
    }
  }, [isLiveAutoRefreshWorking, lastNewsUpdate, loadNews, resetNewArticlesCount]);

  const toggleFilter = useCallback((type, value) => {
    setActiveFilters((current) => {
      const values = current[type] || [];
      const exists = values.includes(value);

      return {
        ...current,
        [type]: exists ? values.filter((item) => item !== value) : [...values, value]
      };
    });
  }, []);

  const openReader = useCallback((group, articleId) => {
    setReaderState({ isOpen: true, group, articleId });
  }, []);

  const closeReader = useCallback(() => {
    setReaderState({ isOpen: false, group: null, articleId: null });
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className={`sticky top-0 z-50 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur-md transition-shadow duration-200 ${topNavCompact ? 'shadow-md' : 'shadow-sm'}`}>
        <div className={`mx-auto flex max-w-7xl flex-col px-4 transition-all duration-200 lg:px-6 ${topNavCompact ? 'gap-2 py-2.5' : 'gap-4 py-5'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => loadNews({ page: 1, append: false, resetRealtime: true })}
                className="group flex items-center gap-3 rounded-2xl text-left transition-opacity hover:opacity-85 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2"
                aria-label={t('refresh')}
                disabled={loading}
              >
                <div className="relative">
                  <BrandMark className={`transition-all duration-200 ${topNavCompact ? 'h-9 w-9' : 'h-11 w-11'}`} />
                  {loading && (
                    <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-700" aria-hidden="true" />
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <h1 className={`truncate font-semibold tracking-tight transition-all duration-200 ${topNavCompact ? 'text-xl' : 'text-2xl'}`}>{t('pageTitle')}</h1>
                </div>
              </button>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <DesktopTopNavFilters
                visibleSources={visibleAvailableSources}
                availableTopics={availableTopics}
                activeFilters={activeFilters}
                showRecentOnly={showRecentOnly}
                search={search}
                recentHours={recentHours}
                t={t}
                locale={locale}
                onToggleFilter={toggleFilter}
                onToggleRecent={() => setShowRecentOnly((value) => !value)}
                onSearchChange={setSearch}
                onSearchClear={() => {
                  setSearch('');
                  setDebouncedSearch('');
                }}
                onOpenSurface={() => setUserMenuOpen(false)}
                closeSignal={desktopFiltersCloseSignal}
                compact={topNavCompact}
              />

              <div className="relative">
                <TopNavActionButton
                  icon={RefreshCw}
                  label={t('refresh')}
                  onClick={() => loadNews({ page: 1, append: false, resetRealtime: true })}
                  disabled={isLiveAutoRefreshWorking || loading || loadingMore}
                  aria-label={refreshButtonLabel}
                  iconClassName={(loading || loadingMore) ? 'animate-spin' : ''}
                />
              </div>

              <div className="relative" ref={userMenuRef}>
                <TopNavActionButton
                  icon={User}
                  label={t('userMenu')}
                  onClick={() => {
                    setUserMenuOpen((current) => {
                      const nextOpen = !current;
                      if (nextOpen) {
                        setDesktopFiltersCloseSignal((value) => value + 1);
                      }
                      return nextOpen;
                    });
                  }}
                  active={userMenuOpen}
                  className="z-20"
                  aria-expanded={userMenuOpen}
                  aria-haspopup="menu"
                  aria-label={t('userMenu')}
                />

                {userMenuOpen && (
                  <div className={`absolute right-0 ${topNavCompact ? 'top-[calc(100%+1rem)]' : 'top-[calc(100%+1.625rem)]'} z-50 w-60 overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white/95 shadow-2xl backdrop-blur transition-all duration-200`} role="menu">
                    <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-4">
                      <div className="flex items-start gap-3">
                        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-sky-700 shadow-sm">
                          <User className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t('userMenu')}</p>
                          <p className="mt-1 truncate text-sm font-semibold text-slate-900">{currentUser?.user?.username}</p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 p-3">
                      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-700">
                        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${!autoRefreshEnabled ? 'bg-slate-200 text-slate-700' : (isConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}`}>
                          {!autoRefreshEnabled ? (
                            <PauseCircle className="h-4 w-4" aria-hidden="true" />
                          ) : (isConnected ? <RefreshCw className="h-4 w-4" aria-hidden="true" /> : <WifiOff className="h-4 w-4" aria-hidden="true" />)}
                        </span>
                        <div className="min-w-0 leading-5">
                          <p className="font-medium text-slate-800">{t('autoRefreshStatus')}</p>
                          <p className="text-slate-500">{liveStatusLabel}</p>
                        </div>
                      </div>

                      <div className="space-y-2 pt-1">
                      <button
                        type="button"
                          onClick={() => {
                            setSettingsOpen(true);
                            setUserMenuOpen(false);
                          }}
                          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
                          role="menuitem"
                        >
                          <span className="flex items-center gap-3">
                            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                              <Cog className="h-4 w-4" />
                            </span>
                            {t('settings')}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFeedbackOpen(true);
                            setUserMenuOpen(false);
                          }}
                          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
                          role="menuitem"
                        >
                          <span className="flex items-center gap-3">
                            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                              <MessageSquare className="h-4 w-4" />
                            </span>
                            {t('feedbackMenuItem')}
                          </span>
                        </button>
                      <button
                        type="button"
                        onClick={onLogout}
                        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-left text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100"
                        role="menuitem"
                      >
                        <span className="flex items-center gap-3">
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-rose-700">
                            <LogOut className="h-4 w-4" />
                          </span>
                          {t('logout')}
                        </span>
                      </button>
                    </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-4 pb-24 md:pb-10 lg:px-6">
        {loading && !loadingMore ? (
          <div className="flex h-64 items-center justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
          </div>
        ) : error ? (
          <ErrorMessage error={error} onRetry={() => loadNews({ page: 1, append: false, resetRealtime: true })} t={t} />
        ) : news.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <h2 className="text-xl font-semibold text-slate-800">{t('noNewsTitle')}</h2>
            <p className="mt-2 text-slate-500">{t('noNewsText')}</p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {news.map((group) => (
                <NewsCard
                  key={group.id}
                  group={group}
                  showImages={showNewsImages}
                  compact={compactNewsCards}
                  locale={locale}
                  t={t}
                  onOpenReader={openReader}
                />
              ))}
            </div>

            <div className="mt-8 flex justify-center">
              {meta?.hasMore ? (
                <button
                  type="button"
                  onClick={() => loadNews(
                    meta?.nextCursor
                      ? { append: true, resetRealtime: false, cursor: meta.nextCursor }
                      : { page: (meta?.page || 1) + 1, append: true, resetRealtime: false }
                  )}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  )}
                  {loadingMore ? t('loadingMore') : t('loadMore')}
                </button>
              ) : (
                <p className="text-sm text-slate-500">{t('noMoreResults')}</p>
              )}
            </div>
          </>
        )}
      </main>

      {readerState.isOpen && readerState.group && (
        <ReaderPanel
          group={readerState.group}
          initialArticleId={readerState.articleId}
          readerPosition={currentUser?.settings?.readerPanelPosition || 'right'}
          locale={locale}
          t={t}
          currentUser={currentUser}
          onClose={closeReader}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          t={t}
          currentUser={currentUser}
          availableSources={sourceCatalog}
          currentChangelogVersion={currentChangelogVersion}
          onClose={() => setSettingsOpen(false)}
          onOpenReleaseNotes={onOpenReleaseNotes}
          onUserUpdate={onUserUpdate}
        />
      )}

      {feedbackOpen && (
        <FeedbackModal
          t={t}
          feedbackLimits={currentUser?.limits}
          onClose={() => setFeedbackOpen(false)}
        />
      )}

      <button
        type="button"
        onClick={scrollToTop}
        className={`fixed bottom-20 left-4 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-lg backdrop-blur transition-all duration-200 hover:bg-white hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 sm:bottom-6 sm:left-6 ${
          showBackToTop
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-3 opacity-0'
        }`}
        aria-label={t('backToTop')}
      >
        <ArrowUp className="h-5 w-5" aria-hidden="true" />
      </button>

      {!readerState.isOpen && !settingsOpen && !feedbackOpen ? (
        <MobileBottomNav
          visibleSources={visibleAvailableSources}
          availableTopics={availableTopics}
          activeFilters={activeFilters}
          showRecentOnly={showRecentOnly}
          search={search}
          recentHours={recentHours}
          t={t}
          locale={locale}
          onToggleFilter={toggleFilter}
          onToggleRecent={() => setShowRecentOnly((v) => !v)}
          onSearchChange={setSearch}
          onSearchClear={() => {
            setSearch('');
            setDebouncedSearch('');
          }}
          visible={showMobileNav}
        />
      ) : null}
    </div>
  );
};

export default NewsAggregator;
