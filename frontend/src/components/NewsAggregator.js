import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Cog,
  Filter,
  LogOut,
  MessageSquare,
  PauseCircle,
  RefreshCw,
  Rss,
  Search,
  Tags,
  Clock3,
  ChevronDown,
  ChevronUp,
  User,
  WifiOff,
  X
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
import { createTranslator, getLocalizedTopic, LOCALE_STORAGE_KEY, resolvePreferredLocale } from '../i18n';
import { getSettingsLimits } from '../config/settingsLimits';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import { getTopicPresentation } from '../topicPresentation';
import { setStoredReaderTextSizePreference } from '../utils/readerTextSizePreference';

const PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 350;
const EMPTY_FILTERS = { sourceIds: [], topics: [] };

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
  const [locale, setLocale] = useState(() => resolvePreferredLocale(preferredLanguage));
  const t = useMemo(() => createTranslator(locale), [locale]);
  const settingsLimits = useMemo(() => getSettingsLimits(currentUser), [currentUser]);
  const websocketMessages = useMemo(() => ({
    connected: t('wsConnected'),
    disconnected: t('wsDisconnected'),
    reconnectFailed: t('wsReconnectFailed'),
    newGroups: (count) => t('wsNewGroups', { count })
  }), [t]);
  const {
    isConnected,
    lastNewsUpdate,
    updateSubscriptionFilters,
    resetNewArticlesCount,
    markGroupsSeen
  } = useWebSocket('', websocketMessages, autoRefreshEnabled);
  const liveStatusLabel = autoRefreshEnabled
    ? (isConnected ? t('liveActive') : t('liveOffline'))
    : t('liveDisabled');
  const lastNewsUpdateRef = useRef(null);
  const { startLatestRequest } = useLatestRequest();

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
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [readerState, setReaderState] = useState({ isOpen: false, group: null, articleId: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
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
    const request = startLatestRequest();

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
        signal: request.signal
      });

      if (!request.isLatest()) {
        return;
      }

      setNews((current) => append ? appendUniqueGroups(current, response.items || []) : (response.items || []));
      setMeta(response.meta || null);
      setAvailableSources(response.filters?.sources || []);
      setSourceCatalog(response.filters?.sourceCatalog || []);
      setAvailableTopics(response.filters?.topics || []);

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
  }, [activeFilters.sourceIds, activeFilters.topics, debouncedSearch, recentHours, resetNewArticlesCount, showRecentOnly, startLatestRequest]);

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

    if (Array.isArray(lastNewsUpdate.data) && lastNewsUpdate.data.length > 0) {
      setNews((current) => mergeUniqueGroups(current, lastNewsUpdate.data));
      resetNewArticlesCount();
    }
  }, [isLiveAutoRefreshWorking, lastNewsUpdate, resetNewArticlesCount]);

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

  const resetFilters = useCallback(() => {
    setActiveFilters({ sourceIds: [], topics: [] });
    setShowRecentOnly(false);
    setSearch('');
    setDebouncedSearch('');
  }, []);

  const activeFiltersCount = useMemo(() => {
    return activeFilters.sourceIds.length + activeFilters.topics.length + (showRecentOnly ? 1 : 0) + (debouncedSearch ? 1 : 0);
  }, [activeFilters.sourceIds.length, activeFilters.topics.length, debouncedSearch, showRecentOnly]);

  const hasActiveFilters = activeFiltersCount > 0;

  const openReader = useCallback((group, articleId) => {
    setReaderState({ isOpen: true, group, articleId });
  }, []);

  const closeReader = useCallback(() => {
    setReaderState({ isOpen: false, group: null, articleId: null });
  }, []);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="relative z-40 border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 lg:px-6">
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
                  <BrandMark className="h-11 w-11" />
                  {loading && (
                    <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-700" aria-hidden="true" />
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-2xl font-semibold tracking-tight">{t('pageTitle')}</h1>
                </div>
              </button>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => loadNews({ page: 1, append: false, resetRealtime: true })}
                  disabled={isLiveAutoRefreshWorking || loading || loadingMore}
                  className={`relative rounded-full p-2 shadow-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isLiveAutoRefreshWorking
                      ? 'cursor-not-allowed bg-slate-100 text-slate-300 shadow-none'
                      : 'bg-white text-gray-600 hover:bg-gray-100'
                  }`}
                  aria-label={refreshButtonLabel}
                >
                  <RefreshCw className={`h-6 w-6 ${(loading || loadingMore) ? 'animate-spin' : ''}`} aria-hidden="true" />
                </button>
              </div>

              <div className="relative" ref={userMenuRef}>
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((current) => !current)}
                  className="relative z-20 rounded-full bg-white p-2 shadow-md transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  aria-expanded={userMenuOpen}
                  aria-haspopup="menu"
                  aria-label={t('userMenu')}
                >
                  <User className="h-6 w-6 text-gray-600" />
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 top-14 z-50 w-60 overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white/95 shadow-2xl backdrop-blur" role="menu">
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

      <section className="sticky top-0 z-30 bg-transparent">
        <div className="mx-auto max-w-7xl px-4 py-3 lg:px-6">
          <div className="relative">
            <div className={`overflow-hidden border border-slate-200/80 bg-white/90 shadow-[0_12px_30px_rgba(15,23,42,0.08)] backdrop-blur-md transition-[border-radius] ${filtersExpanded ? 'rounded-t-[1.75rem] rounded-b-none' : 'rounded-[1.75rem]'}`}>
              <div className="border-b border-slate-200/70 px-4 py-3 sm:px-5">
                <label className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-2.5 shadow-sm backdrop-blur-sm">
                  <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t('searchPlaceholder')}
                    className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearch('');
                        setDebouncedSearch('');
                      }}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-300"
                      aria-label={t('clearSearch')}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </label>
              </div>

              <button
                type="button"
                onClick={() => setFiltersExpanded((value) => !value)}
                className="flex w-full items-center justify-between px-4 py-3 text-left sm:px-5"
              >
                <div className="flex items-center gap-3">
                  <Filter className="h-5 w-5 text-slate-500" aria-hidden="true" />
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{t('filtersTitle')}</h2>
                    <p className="text-xs text-slate-600 sm:text-sm">{t('filtersSubtitle')}</p>
                  </div>
                  {activeFiltersCount > 0 && (
                    <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-medium text-white">
                      {activeFiltersCount}
                    </span>
                  )}
                </div>
                {filtersExpanded ? <ChevronUp className="h-5 w-5 text-slate-500" /> : <ChevronDown className="h-5 w-5 text-slate-500" />}
              </button>
            </div>

            <div
              className={`absolute left-0 right-0 top-full z-20 -mt-px max-h-[calc(100vh-8.5rem)] origin-top overflow-y-auto overscroll-contain rounded-b-[1.75rem] border border-slate-200/80 border-t-0 bg-white/90 shadow-[0_12px_30px_rgba(15,23,42,0.08)] backdrop-blur-md transition-all duration-200 ease-out ${
                filtersExpanded
                  ? 'pointer-events-auto translate-y-0 scale-y-100 opacity-100'
                  : 'pointer-events-none -translate-y-2 scale-y-95 opacity-0'
              }`}
              aria-hidden={!filtersExpanded}
            >
                <div className="px-4 py-5 sm:px-5">
                  <div className="mb-5 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setShowRecentOnly((value) => !value)}
                      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                        showRecentOnly ? 'bg-amber-500 text-white shadow-sm' : 'bg-amber-100 text-amber-900 hover:bg-amber-200'
                      }`}
                    >
                      <Clock3 className="h-4 w-4" aria-hidden="true" />
                      {t('latestHours', { hours: recentHours })}
                    </button>

                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
                      >
                        {t('resetFilters')}
                      </button>
                    )}
                  </div>

                  <div className="grid gap-6 lg:grid-cols-2">
                    <div>
                      <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">
                        <Rss className="h-4 w-4" aria-hidden="true" />
                        <span>{t('sources')}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {visibleAvailableSources.map((source) => {
                          const isActive = activeFilters.sourceIds.includes(source.id);
                          return (
                            <button
                              key={source.id}
                              type="button"
                              onClick={() => toggleFilter('sourceIds', source.id)}
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
                    </div>

                    <div>
                      <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">
                        <Tags className="h-4 w-4" aria-hidden="true" />
                        <span>{t('topics')}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {availableTopics.map((topic) => {
                          const isActive = activeFilters.topics.includes(topic.topic);
                          const { Icon, iconBadgeClassName } = getTopicPresentation(topic.topic);
                          return (
                            <button
                              key={topic.topic}
                              type="button"
                              onClick={() => toggleFilter('topics', topic.topic)}
                              className={`inline-flex items-center gap-1.5 rounded-full border pl-1 pr-1 py-1 text-sm font-medium transition-colors ${
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
                    </div>
                  </div>
                </div>
              </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-4 py-4 pb-10 lg:px-6">
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
                  {loadingMore && <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />}
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
          currentUser={currentUser}
          onClose={() => setFeedbackOpen(false)}
        />
      )}
    </div>
  );
};

export default NewsAggregator;
