import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Cog,
  LogOut,
  MessageSquare,
  RefreshCw,
  User,
} from 'lucide-react';
import { fetchNews, isRequestCanceled } from '../services/api';
import ErrorMessage from './ErrorMessage';
import NewsCard from './NewsCard';
import ReaderPanel from './ReaderPanel';
import BrandMark from './BrandMark';
import FeedbackModal from './FeedbackModal';
import SettingsPanel from './SettingsPanel';
import SourceSetupWizard from './SourceSetupWizard';
import useLatestRequest from '../hooks/useLatestRequest';
import useTopicRefreshSocket from '../hooks/useTopicRefreshSocket';
import { createTranslator, LOCALE_STORAGE_KEY, resolvePreferredLocale } from '../i18n';
import { getSettingsLimits } from '../config/settingsLimits';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import { setStoredReaderTextSizePreference } from '../utils/readerTextSizePreference';
import MobileBottomNav from './MobileBottomNav';
import DesktopTopNavFilters from './DesktopTopNavFilters';
import TopNavActionButton from './TopNavActionButton';

const PAGE_SIZE = 12;
const MAX_TOPIC_RELOAD_PAGE_SIZE = 30;
const MAX_RETAINED_NEWS_GROUPS = 72;
const SEARCH_DEBOUNCE_MS = 350;
const EMPTY_FILTERS = { sourceIds: [], topics: [] };
const BACK_TO_TOP_THRESHOLD = 280;
const TOP_NAV_SHRINK_THRESHOLD = 28;
const mergeGroups = (primaryGroups, secondaryGroups) => {
  const merged = new Map();

  [...primaryGroups, ...secondaryGroups].forEach((group) => {
    if (group?.id && !merged.has(group.id)) {
      merged.set(group.id, group);
    }
  });

  return [...merged.values()];
};

const appendUniqueGroups = (currentGroups, incomingGroups) => mergeGroups(currentGroups, incomingGroups);

const getSourceReloadSignature = (excludedSourceIds, excludedSubSourceIds, customSources) => JSON.stringify({
  excludedSourceIds,
  excludedSubSourceIds,
  customSources: (customSources || []).map((source) => [source.id, source.name, source.url, source.language, source.isActive !== false])
});

const NewsAggregator = ({ currentUser, onLogout, onUserUpdate, currentChangelogVersion, onOpenReleaseNotes }) => {
  const preferredLanguage = currentUser?.settings?.defaultLanguage;
  const needsSourceSetup = currentUser?.settings?.sourceSetupCompleted === false && !currentUser?.user?.isAdmin;
  const showNewsImages = currentUser?.settings?.showNewsImages !== false;
  const [locale, setLocale] = useState(() => resolvePreferredLocale(preferredLanguage));
  const t = useMemo(() => createTranslator(locale), [locale]);
  const settingsLimits = useMemo(() => getSettingsLimits(currentUser), [currentUser]);
  const scrollFrameRef = useRef(null);
  const { startLatestRequest: startListRequest } = useLatestRequest();
  const { startLatestRequest: startPaginationRequest, cancelLatestRequest: cancelPaginationRequest } = useLatestRequest();

  const [news, setNews] = useState([]);
  const [meta, setMeta] = useState(null);
  const [availableSources, setAvailableSources] = useState([]);
  const [sourceCatalog, setSourceCatalog] = useState([]);
  const [availableTopics, setAvailableTopics] = useState([]);
  const [loading, setLoading] = useState(() => !needsSourceSetup);
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
  const [pendingNewsGroupIds, setPendingNewsGroupIds] = useState([]);
  const [desktopFiltersCloseSignal, setDesktopFiltersCloseSignal] = useState(0);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(true);
  const [topNavCompact, setTopNavCompact] = useState(false);
  const lastScrollY = useRef(0);
  const userMenuRef = useRef(null);
  const visibleNewsCountRef = useRef(0);
  const preservedNewsCountRef = useRef(0);
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
  visibleNewsCountRef.current = news.length;
  const retainedNewsLimitReached = news.length >= MAX_RETAINED_NEWS_GROUPS;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const setupSourceCatalog = currentUser?.sourceCatalog || sourceCatalog;

  const visibleAvailableSources = useMemo(() => {
    return availableSources.filter((source) => !excludedSourceIds.includes(source.id));
  }, [availableSources, excludedSourceIds]);
  const isFeedRefreshActive = loading || loadingMore;
  const pendingNewsCount = pendingNewsGroupIds.length;
  const socketSubscription = useMemo(() => ({
    search: debouncedSearch,
    sourceIds: activeFilters.sourceIds,
    topics: activeFilters.topics,
    recentHours: showRecentOnly ? recentHours : null,
    excludedSourceIds,
    excludedSubSourceIds
  }), [activeFilters.sourceIds, activeFilters.topics, debouncedSearch, excludedSourceIds, excludedSubSourceIds, recentHours, showRecentOnly]);

  useOnClickOutside(userMenuRef, () => setUserMenuOpen(false));

  useEffect(() => {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Keep the runtime locale even when browser storage is unavailable.
    }
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
    setActiveFilters((current) => {
      const nextSourceIds = current.sourceIds.filter((sourceId) => !excludedSourceIds.includes(sourceId));
      if (nextSourceIds.length === current.sourceIds.length) {
        return current;
      }

      return {
        ...current,
        sourceIds: nextSourceIds
      };
    });
  }, [excludedSourceIds]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [search]);

  const loadNews = useCallback(async function loadNewsRequest({
    page = 1,
    append = false,
    cursor = null,
    forceRefresh = false,
    silent = false,
    minimumItemCount = 0
  } = {}) {
    const setBusyState = append ? setLoadingMore : (silent ? () => {} : setLoading);
    const request = append ? startPaginationRequest() : startListRequest();

    if (append) {
      preservedNewsCountRef.current = Math.max(preservedNewsCountRef.current || visibleNewsCountRef.current || PAGE_SIZE, visibleNewsCountRef.current || PAGE_SIZE) + PAGE_SIZE;
    }

    if (!append) {
      cancelPaginationRequest();
      setLoadingMore(false);
    }

    setBusyState(true);
    setError(null);

    try {
      const responsePageSize = append
        ? PAGE_SIZE
        : Math.min(Math.max(PAGE_SIZE, minimumItemCount || PAGE_SIZE), MAX_TOPIC_RELOAD_PAGE_SIZE);
      const response = await fetchNews({
        page,
        pageSize: responsePageSize,
        search: debouncedSearch,
        sourceIds: activeFilters.sourceIds,
        topics: activeFilters.topics,
        recentHours: showRecentOnly ? recentHours : null,
        beforePubDate: append ? cursor?.beforePubDate : '',
        beforeId: append ? cursor?.beforeId : '',
        refresh: forceRefresh,
        includeFilters: !append,
        signal: request.signal
      });

      if (!request.isLatest()) {
        return;
      }

      const targetItemCount = append ? 0 : minimumItemCount;
      const mergedItems = response.items || [];
      let nextMeta = response.meta || null;

      while (
        !append
        && mergedItems.length < targetItemCount
        && nextMeta?.hasMore
        && nextMeta?.nextCursor
      ) {
        const nextPage = await fetchNews({
          page: 1,
          pageSize: Math.min(targetItemCount - mergedItems.length, MAX_TOPIC_RELOAD_PAGE_SIZE),
          search: debouncedSearch,
          sourceIds: activeFilters.sourceIds,
          topics: activeFilters.topics,
          recentHours: showRecentOnly ? recentHours : null,
          beforePubDate: nextMeta.nextCursor.beforePubDate,
          beforeId: nextMeta.nextCursor.beforeId,
          refresh: false,
          includeFilters: false,
          signal: request.signal
        });

        if (!request.isLatest()) {
          return;
        }

        mergedItems.splice(0, mergedItems.length, ...appendUniqueGroups(mergedItems, nextPage.items || []));
        nextMeta = nextPage.meta || nextMeta;
      }

      setNews((current) => {
        let nextNews = append ? appendUniqueGroups(current, response.items || []) : mergedItems;

        if (!append && silent && current.length > nextNews.length) {
          const preservedTail = current.slice(nextNews.length);
          nextNews = appendUniqueGroups(nextNews, preservedTail).slice(0, current.length);
        }

        if (nextNews.length > MAX_RETAINED_NEWS_GROUPS) {
          nextNews = nextNews.slice(0, MAX_RETAINED_NEWS_GROUPS);
        }

        visibleNewsCountRef.current = nextNews.length;
        preservedNewsCountRef.current = nextNews.length;
        return nextNews;
      });
      setMeta((currentMeta) => {
        if (!append && silent && visibleNewsCountRef.current > mergedItems.length) {
          return currentMeta || metaRef.current || nextMeta;
        }

        return nextMeta;
      });
      if (!append) {
        setPendingNewsGroupIds([]);
      }
      if (response.filters) {
        setAvailableSources(response.filters.sources || []);
        setSourceCatalog(response.filters.sourceCatalog || []);
        setAvailableTopics(response.filters.topics || []);
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
  }, [activeFilters.sourceIds, activeFilters.topics, cancelPaginationRequest, debouncedSearch, recentHours, showRecentOnly, startListRequest, startPaginationRequest]);

  const handleTopicRefresh = useCallback(() => {
    loadNews({
      page: 1,
      append: false,
      silent: true,
      minimumItemCount: Math.max(visibleNewsCountRef.current, preservedNewsCountRef.current)
    });
  }, [loadNews]);

  const handleNewsUpdate = useCallback((payload = {}) => {
    const incomingGroupIds = (Array.isArray(payload.groupIds) ? payload.groupIds : []).filter(Boolean);

    if (incomingGroupIds.length === 0) {
      return;
    }

    setPendingNewsGroupIds((current) => {
      const nextIds = new Set(current);
      incomingGroupIds.forEach((groupId) => nextIds.add(groupId));
      return nextIds.size === current.length ? current : [...nextIds];
    });
  }, []);

  useTopicRefreshSocket({
    onTopicRefresh: handleTopicRefresh,
    onNewsUpdate: handleNewsUpdate,
    subscription: socketSubscription
  });

  useEffect(() => {
    if (needsSourceSetup) {
      sourceReloadSignatureRef.current = sourceReloadSignature;
      return;
    }

    if (sourceReloadSignature === sourceReloadSignatureRef.current) {
      return;
    }

    sourceReloadSignatureRef.current = sourceReloadSignature;
    loadNews({ page: 1, append: false });
  }, [loadNews, needsSourceSetup, sourceReloadSignature]);

  useEffect(() => {
    if (needsSourceSetup) {
      setLoading(false);
      setError(null);
      return;
    }

    loadNews({ page: 1, append: false });
  }, [loadNews, needsSourceSetup]);

  const handleSourceSetupComplete = useCallback((settings) => {
    onUserUpdate({
      ...currentUser,
      settings
    });
  }, [currentUser, onUserUpdate]);

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
    <div className="min-h-screen overflow-x-clip bg-slate-100 text-slate-900">
      <header className={`sticky top-0 z-50 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur-md transition-shadow duration-200 ${topNavCompact ? 'shadow-md' : 'shadow-sm'}`}>
        <div className={`mx-auto flex max-w-7xl flex-col px-4 transition-all duration-200 lg:px-6 ${topNavCompact ? 'gap-2 py-2.5' : 'gap-4 py-5'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <BrandMark className={`transition-all duration-200 ${topNavCompact ? 'h-9 w-9' : 'h-11 w-11'}`} />
                <div className="min-w-0">
                  <h1 className={`truncate font-semibold tracking-tight transition-all duration-200 ${topNavCompact ? 'text-xl' : 'text-2xl'}`}>{t('pageTitle')}</h1>
                </div>
              </div>
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
                  onClick={() => loadNews({ page: 1, append: false, forceRefresh: true })}
                  disabled={isFeedRefreshActive}
                  aria-label={t('refresh')}
                  iconClassName={isFeedRefreshActive ? 'animate-spin' : ''}
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

      <main className="mx-auto w-full max-w-7xl px-4 py-4 pb-24 md:pb-10 lg:px-6">
        {loading && !loadingMore ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
          </div>
        ) : error ? (
          <ErrorMessage error={error} onRetry={() => loadNews({ page: 1, append: false, forceRefresh: true })} t={t} />
        ) : news.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <h2 className="text-xl font-semibold text-slate-800">{t('noNewsTitle')}</h2>
            <p className="mt-2 text-slate-500">{t('noNewsText')}</p>
          </div>
        ) : (
          <>
            {pendingNewsCount > 0 && (
              <div className="mb-4 flex justify-center">
                <div
                  role="status"
                  aria-live="polite"
                  className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 shadow-sm"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  {t('newArticlesAvailable', { count: pendingNewsCount })}
                </div>
              </div>
            )}

            <div className="grid w-full min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {news.map((group) => (
                <div key={group.id} className="min-w-0">
                  <NewsCard
                    group={group}
                    showImages={showNewsImages}
                    locale={locale}
                    t={t}
                    onOpenReader={openReader}
                  />
                </div>
              ))}
            </div>

            <div className="mt-8 flex justify-center">
              {meta?.hasMore && !retainedNewsLimitReached ? (
                <button
                  type="button"
                  onClick={() => loadNews(
                    meta?.nextCursor
                      ? { append: true, cursor: meta.nextCursor }
                      : { page: (meta?.page || 1) + 1, append: true }
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

      {needsSourceSetup && (
        <SourceSetupWizard
          t={t}
          sources={setupSourceCatalog}
          currentSettings={currentUser.settings}
          onComplete={handleSourceSetupComplete}
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
