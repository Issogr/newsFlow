import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Cog,
  Filter,
  LogOut,
  RefreshCw,
  Search,
  Clock3,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { fetchNews } from '../services/api';
import ErrorMessage from './ErrorMessage';
import NewsCard from './NewsCard';
import NotificationCenter from './NotificationCenter';
import ReaderPanel from './ReaderPanel';
import BrandMark from './BrandMark';
import SettingsPanel from './SettingsPanel';
import useWebSocket from '../hooks/useWebSocket';
import { createTranslator, detectBrowserLocale, getDateLocale } from '../i18n';

const PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 350;
const EMPTY_FILTERS = { sourceIds: [], topics: [] };

const mergeUniqueGroups = (currentGroups, incomingGroups) => {
  const merged = new Map();

  [...incomingGroups, ...currentGroups].forEach((group) => {
    if (group?.id && !merged.has(group.id)) {
      merged.set(group.id, group);
    }
  });

  return [...merged.values()];
};

const appendUniqueGroups = (currentGroups, incomingGroups) => {
  const merged = new Map();

  [...currentGroups, ...incomingGroups].forEach((group) => {
    if (group?.id && !merged.has(group.id)) {
      merged.set(group.id, group);
    }
  });

  return [...merged.values()];
};

const NewsAggregator = ({ currentUser, onLogout, onUserUpdate }) => {
  const preferredLanguage = currentUser?.settings?.defaultLanguage;
  const [locale, setLocale] = useState(() => {
    const savedLocale = window.localStorage.getItem('news-aggregator-locale');
    if (preferredLanguage === 'it' || preferredLanguage === 'en') {
      return preferredLanguage;
    }
    return savedLocale === 'it' || savedLocale === 'en' ? savedLocale : detectBrowserLocale();
  });
  const t = useMemo(() => createTranslator(locale), [locale]);
  const dateLocale = useMemo(() => getDateLocale(locale), [locale]);
  const websocketMessages = useMemo(() => ({
    connected: t('wsConnected'),
    disconnected: t('wsDisconnected'),
    reconnectFailed: t('wsReconnectFailed'),
    newGroups: (count) => t('wsNewGroups', { count })
  }), [t]);
  const {
    isConnected,
    notifications,
    lastNewsUpdate,
    lastTopicUpdate,
    newArticlesCount,
    reconnectionEvent,
    updateSubscriptionFilters,
    resetNewArticlesCount,
    removeNotification
  } = useWebSocket('', websocketMessages);
  const lastNewsUpdateRef = useRef(null);
  const lastTopicUpdateRef = useRef(null);

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
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  const [readerState, setReaderState] = useState({ isOpen: false, group: null, articleId: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const recentHours = Math.max(1, Math.min(Number(currentUser?.settings?.recentHours) || 3, 3));
  const hiddenSourceIds = useMemo(() => currentUser?.settings?.hiddenSourceIds || [], [currentUser?.settings?.hiddenSourceIds]);
  const customSourcesSignature = useMemo(() => {
    return JSON.stringify((currentUser?.customSources || []).map((source) => [source.id, source.url]));
  }, [currentUser?.customSources]);
  const hiddenSourcesInitializedRef = useRef(false);
  const customSourcesInitializedRef = useRef(false);
  const visibleAvailableSources = useMemo(() => {
    return availableSources.filter((source) => !hiddenSourceIds.includes(source.id));
  }, [availableSources, hiddenSourceIds]);

  useEffect(() => {
    window.localStorage.setItem('news-aggregator-locale', locale);
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (preferredLanguage === 'it' || preferredLanguage === 'en') {
      setLocale(preferredLanguage);
    }
  }, [preferredLanguage]);

  useEffect(() => {
    setActiveFilters((current) => ({
      ...current,
      sourceIds: current.sourceIds.filter((sourceId) => !hiddenSourceIds.includes(sourceId))
    }));
  }, [hiddenSourceIds]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [search]);

  const loadNews = useCallback(async ({ page = 1, append = false, resetRealtime = true } = {}) => {
    const setBusyState = append ? setLoadingMore : setLoading;
    setBusyState(true);
    setError(null);

    try {
      const response = await fetchNews({
        page,
        pageSize: PAGE_SIZE,
        search: debouncedSearch,
        sourceIds: activeFilters.sourceIds,
        topics: activeFilters.topics,
        recentHours: showRecentOnly ? recentHours : null
      });

      setNews((current) => append ? appendUniqueGroups(current, response.items || []) : (response.items || []));
      setMeta(response.meta || null);
      setAvailableSources(response.filters?.sources || []);
      setSourceCatalog(response.filters?.sourceCatalog || []);
      setAvailableTopics(response.filters?.topics || []);

      if (resetRealtime) {
        resetNewArticlesCount();
      }
    } catch (requestError) {
      setError(requestError);
    } finally {
      setBusyState(false);
    }
  }, [activeFilters.sourceIds, activeFilters.topics, debouncedSearch, recentHours, resetNewArticlesCount, showRecentOnly]);

  useEffect(() => {
    if (!hiddenSourcesInitializedRef.current) {
      hiddenSourcesInitializedRef.current = true;
      return;
    }

    loadNews({ page: 1, append: false, resetRealtime: false });
  }, [hiddenSourceIds, loadNews]);

  useEffect(() => {
    if (!customSourcesInitializedRef.current) {
      customSourcesInitializedRef.current = true;
      return;
    }

    loadNews({ page: 1, append: false, resetRealtime: false });
  }, [customSourcesSignature, loadNews]);

  useEffect(() => {
    loadNews({ page: 1, append: false, resetRealtime: false });
  }, [loadNews]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }

    updateSubscriptionFilters({
      topics: activeFilters.topics,
      sourceIds: activeFilters.sourceIds
    });
  }, [activeFilters.sourceIds, activeFilters.topics, isConnected, updateSubscriptionFilters]);

  useEffect(() => {
    if (!reconnectionEvent) {
      return;
    }

    updateSubscriptionFilters({
      topics: activeFilters.topics,
      sourceIds: activeFilters.sourceIds
    });
  }, [activeFilters.sourceIds, activeFilters.topics, reconnectionEvent, updateSubscriptionFilters]);

  useEffect(() => {
    if (!lastNewsUpdate?.timestamp || lastNewsUpdate.timestamp === lastNewsUpdateRef.current) {
      return;
    }

    lastNewsUpdateRef.current = lastNewsUpdate.timestamp;

    if (debouncedSearch || showRecentOnly) {
      return;
    }

    if (Array.isArray(lastNewsUpdate.data) && lastNewsUpdate.data.length > 0) {
      setNews((current) => mergeUniqueGroups(current, lastNewsUpdate.data));
    }
  }, [debouncedSearch, lastNewsUpdate, showRecentOnly]);

  useEffect(() => {
    const topicUpdate = lastTopicUpdate;
    if (!topicUpdate?.timestamp || topicUpdate.timestamp === lastTopicUpdateRef.current) {
      return;
    }

    lastTopicUpdateRef.current = topicUpdate.timestamp;

    setNews((current) => current.map((group) => {
      const updatedItems = group.items.map((item) => {
        if (item.id !== topicUpdate.articleId) {
          return item;
        }

        return {
          ...item,
          topics: [...new Set([...(item.topics || []), ...(topicUpdate.topics || [])])]
        };
      });

      const groupHasUpdatedItem = updatedItems.some((item) => item.id === topicUpdate.articleId);
      if (!groupHasUpdatedItem) {
        return group;
      }

      return {
        ...group,
        items: updatedItems,
        topics: [...new Set([...(group.topics || []), ...(topicUpdate.topics || [])])]
      };
    }));
  }, [lastTopicUpdate]);

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
      <header className="border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 lg:px-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <button
                type="button"
                onClick={() => loadNews({ page: 1, append: false, resetRealtime: true })}
                className="group flex items-start gap-3 rounded-2xl text-left transition-opacity hover:opacity-85 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2"
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
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">{t('pageTitle')}</h1>
                  <p className="text-sm text-slate-500">{t('pageSubtitle')}</p>
                </div>
              </button>
            </div>

            <div className="flex items-center gap-3 self-start md:self-auto">
              <div className="flex items-center rounded-full border border-slate-200 bg-white p-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => setLocale('it')}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    locale === 'it' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                  aria-pressed={locale === 'it'}
                >
                  IT
                </button>
                <button
                  type="button"
                  onClick={() => setLocale('en')}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    locale === 'en' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                  aria-pressed={locale === 'en'}
                >
                  EN
                </button>
              </div>

              <NotificationCenter
                notifications={notifications}
                onRemoveNotification={removeNotification}
                newArticlesCount={newArticlesCount}
                onRefresh={() => loadNews({ page: 1, append: false, resetRealtime: true })}
                isConnected={isConnected}
                locale={dateLocale}
                t={t}
              />

              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
              >
                <Cog className="h-4 w-4" />
                {t('settings')}
              </button>

              <button
                type="button"
                onClick={onLogout}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
              >
                <LogOut className="h-4 w-4" />
                {t('logout')}
              </button>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm">
              <Search className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('searchPlaceholder')}
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </label>

            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
              <span className="rounded-full bg-slate-100 px-3 py-1.5">
                {meta?.totalGroups ? t('totalGroups', { count: meta.totalGroups }) : t('visibleGroups', { count: news.length })}
              </span>
              {meta?.lastRefreshAt && (
                <span className="rounded-full bg-slate-100 px-3 py-1.5">
                  {t('updatedAt', {
                    time: new Date(meta.lastRefreshAt).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })
                  })}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 py-4 lg:px-6">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setFiltersExpanded((value) => !value)}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
          >
            <div className="flex items-center gap-3">
              <Filter className="h-5 w-5 text-slate-500" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{t('filtersTitle')}</h2>
                <p className="text-sm text-slate-600">{t('filtersSubtitle')}</p>
              </div>
              {activeFiltersCount > 0 && (
                <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-medium text-white">
                  {activeFiltersCount}
                </span>
              )}
            </div>
            {filtersExpanded ? <ChevronUp className="h-5 w-5 text-slate-500" /> : <ChevronDown className="h-5 w-5 text-slate-500" />}
          </button>

          {filtersExpanded && (
            <div className="border-t border-slate-100 px-5 py-5">
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowRecentOnly((value) => !value)}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    showRecentOnly ? 'bg-amber-500 text-white' : 'bg-amber-100 text-amber-900 hover:bg-amber-200'
                  }`}
                >
                  <Clock3 className="h-4 w-4" aria-hidden="true" />
                  {t('latestHours', { hours: recentHours })}
                </button>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
                  >
                    {t('resetFilters')}
                  </button>
                )}
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-slate-700">{t('sources')}</h3>
                  <div className="flex flex-wrap gap-2">
                    {visibleAvailableSources.map((source) => {
                      const isActive = activeFilters.sourceIds.includes(source.id);
                      return (
                        <button
                          key={source.id}
                          type="button"
                          onClick={() => toggleFilter('sourceIds', source.id)}
                          className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                            isActive
                              ? 'bg-sky-600 text-white'
                              : 'bg-sky-100 text-sky-900 hover:bg-sky-200'
                          }`}
                        >
                          {source.name} {source.count > 0 ? `(${source.count})` : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold text-slate-700">{t('topics')}</h3>
                  <div className="flex flex-wrap gap-2">
                    {availableTopics.map((topic) => {
                      const isActive = activeFilters.topics.includes(topic.topic);
                      return (
                        <button
                          key={topic.topic}
                          type="button"
                          onClick={() => toggleFilter('topics', topic.topic)}
                          className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                            isActive
                              ? 'bg-emerald-600 text-white'
                              : 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200'
                          }`}
                        >
                          {topic.topic} ({topic.count})
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-4 pb-10 lg:px-6">
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
                  activeFilters={activeFilters}
                  toggleFilter={toggleFilter}
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
                  onClick={() => loadNews({ page: (meta?.page || 1) + 1, append: true, resetRealtime: false })}
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
          locale={locale}
          t={t}
          onClose={closeReader}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          t={t}
          currentUser={currentUser}
          availableSources={sourceCatalog}
          onClose={() => setSettingsOpen(false)}
          onUserUpdate={onUserUpdate}
        />
      )}
    </div>
  );
};

export default NewsAggregator;
