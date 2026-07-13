import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Cog,
  LogOut,
  MessageSquare,
  RefreshCw,
  User,
} from 'lucide-react';
import { fetchNews, fetchReadLaterNews, fetchThematicSummaries, isRequestCanceled, markThematicSummariesRead, removeReadLaterArticles, saveReadLaterArticles } from '../services/api';
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
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import { setStoredReaderTextSizePreference } from '../utils/readerTextSizePreference';
import {
  buildFeedRequestParams,
  getGroupMergeKeys,
  getLoadedNewsGroups,
  getSourceReloadSignature,
  groupSharesAnyKey,
  mergeGroups,
} from '../utils/newsFeedGroups';
import {
  getReadThematicSummariesStorageKey,
  getStoredReadThematicSummaryIds,
  mergeReadThematicSummaryIds,
  setStoredReadThematicSummaryIds,
} from '../utils/thematicSummaryReadState';
import MobileBottomNav from './MobileBottomNav';
import DesktopTopNavFilters from './DesktopTopNavFilters';
import TopNavActionButton from './TopNavActionButton';
import ThematicSummaryStories from './ThematicSummaryStories';
import ThematicSummaryPanel from './ThematicSummaryPanel';
import { isPodcastSummary } from '../utils/thematicSummaryLocale';

const PAGE_SIZE = 12;
const MAX_TOPIC_RELOAD_PAGE_SIZE = 30;
const MAX_RETAINED_NEWS_GROUPS = 72;
const SEARCH_DEBOUNCE_MS = 350;
const EMPTY_FILTERS = { sourceIds: [], topics: [] };
const BACK_TO_TOP_THRESHOLD = 280;
const TOP_NAV_SHRINK_THRESHOLD = 28;

function getUserInitials(username = '') {
  const initials = String(username)
    .trim()
    .split(/[\s._@-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');

  return initials.toUpperCase();
}

function UserMenuItem({ icon: Icon, label, onClick, className, iconClassName }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={className || 'flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100'}
      role="menuitem"
    >
      <span className="flex items-center gap-3">
        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${iconClassName}`}>
          <Icon className="h-4 w-4" />
        </span>
        {label}
      </span>
    </button>
  );
}

function getCurrentThematicSummarySelection(selectedSummary, summaries = []) {
  if (!selectedSummary?.id) {
    return null;
  }

  const sameIdSummary = summaries.find((summary) => summary?.id === selectedSummary.id);
  if (sameIdSummary) {
    return sameIdSummary;
  }

  if (isPodcastSummary(selectedSummary)) {
    return summaries.find(isPodcastSummary) || null;
  }

  return summaries.find((summary) => !isPodcastSummary(summary) && summary?.topicKey === selectedSummary.topicKey) || null;
}

function getAiSummaryFeatureState(aiFeatures = {}) {
  const thematicSummariesEnabled = aiFeatures.thematicSummariesEnabled !== false;
  const podcastsEnabled = aiFeatures.podcastsEnabled !== false;

  return {
    thematicSummariesEnabled,
    podcastsEnabled,
    surfaceEnabled: thematicSummariesEnabled || podcastsEnabled
  };
}

function filterThematicSummariesForFeatures(summaries = [], featureState = {}) {
  return (Array.isArray(summaries) ? summaries : []).filter((summary) => {
    return isPodcastSummary(summary)
      ? featureState.podcastsEnabled !== false
      : featureState.thematicSummariesEnabled !== false;
  });
}

const NewsAggregator = ({ currentUser, onLogout, onUserUpdate, currentChangelogVersion, onOpenReleaseNotes }) => {
  const preferredLanguage = currentUser?.settings?.defaultLanguage;
  const needsSourceSetup = currentUser?.settings?.sourceSetupCompleted === false && !currentUser?.user?.isAdmin;
  const showNewsImages = currentUser?.settings?.showNewsImages !== false;
  const [locale, setLocale] = useState(() => resolvePreferredLocale(preferredLanguage));
  const t = useMemo(() => createTranslator(locale), [locale]);
  const scrollFrameRef = useRef(null);
  const { startLatestRequest: startListRequest } = useLatestRequest();
  const { startLatestRequest: startPaginationRequest, cancelLatestRequest: cancelPaginationRequest } = useLatestRequest();
  const { startLatestRequest: startSummaryRequest, cancelLatestRequest: cancelSummaryRequest } = useLatestRequest();

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
  const [activeView, setActiveView] = useState('news');
  const [readerState, setReaderState] = useState({ isOpen: false, group: null, articleId: null });
  const [thematicSummaries, setThematicSummaries] = useState([]);
  const [selectedThematicSummary, setSelectedThematicSummary] = useState(null);
  const [readThematicSummaryIds, setReadThematicSummaryIds] = useState(() => getStoredReadThematicSummaryIds(getReadThematicSummariesStorageKey(currentUser)));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [pendingNewsGroupIds, setPendingNewsGroupIds] = useState([]);
  const [desktopFiltersCloseSignal, setDesktopFiltersCloseSignal] = useState(0);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(true);
  const [topNavCompact, setTopNavCompact] = useState(false);
  const [readLaterUpdatingGroupIds, setReadLaterUpdatingGroupIds] = useState([]);
  const lastScrollY = useRef(0);
  const userMenuRef = useRef(null);
  const visibleNewsCountRef = useRef(0);
  const preservedNewsCountRef = useRef(0);
  const activeListLoadingRequestIdRef = useRef(null);
  const excludedSourceIds = useMemo(() => currentUser?.settings?.excludedSourceIds || [], [currentUser?.settings?.excludedSourceIds]);
  const excludedSubSourceIds = useMemo(() => currentUser?.settings?.excludedSubSourceIds || [], [currentUser?.settings?.excludedSubSourceIds]);
  const sourceReloadSignature = useMemo(() => {
    return getSourceReloadSignature(excludedSourceIds, excludedSubSourceIds, currentUser?.customSources || []);
  }, [currentUser?.customSources, excludedSourceIds, excludedSubSourceIds]);
  const sourceReloadSignatureRef = useRef(sourceReloadSignature);
  const visibleNews = useMemo(() => news.filter((group) => group?.items?.length > 0), [news]);
  visibleNewsCountRef.current = visibleNews.length;
  const retainedNewsLimitReached = visibleNews.length >= MAX_RETAINED_NEWS_GROUPS;
  const isReadLaterView = activeView === 'readLater';
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const setupSourceCatalog = Array.isArray(currentUser?.sourceCatalog) && currentUser.sourceCatalog.length > 0
    ? currentUser.sourceCatalog
    : sourceCatalog;
  const readThematicSummariesStorageKey = useMemo(() => getReadThematicSummariesStorageKey(currentUser), [currentUser]);
  const aiFeatureOptions = currentUser?.features?.ai;
  const aiSummaryFeatureState = useMemo(() => getAiSummaryFeatureState(aiFeatureOptions), [aiFeatureOptions]);
  const visibleThematicSummaries = useMemo(() => {
    return filterThematicSummariesForFeatures(thematicSummaries, aiSummaryFeatureState);
  }, [aiSummaryFeatureState, thematicSummaries]);
  const displayedThematicSummary = useMemo(() => {
    if (!selectedThematicSummary?.id) {
      return null;
    }

    return getCurrentThematicSummarySelection(selectedThematicSummary, visibleThematicSummaries);
  }, [selectedThematicSummary, visibleThematicSummaries]);
  const currentReaderGroup = useMemo(() => {
    if (!readerState.isOpen || !readerState.group) {
      return null;
    }

    const readerGroupKeys = getGroupMergeKeys(readerState.group);
    return news.find((group) => groupSharesAnyKey(group, readerGroupKeys)) || readerState.group;
  }, [news, readerState.group, readerState.isOpen]);

  useEffect(() => {
    if (selectedThematicSummary?.id && !displayedThematicSummary) {
      setSelectedThematicSummary(null);
    }
  }, [displayedThematicSummary, selectedThematicSummary?.id]);

  const visibleAvailableSources = useMemo(() => {
    return availableSources.filter((source) => !excludedSourceIds.includes(source.id));
  }, [availableSources, excludedSourceIds]);
  const isFeedRefreshActive = loading || loadingMore;
  const pendingNewsCount = pendingNewsGroupIds.length;
  const manualRefreshPending = Boolean(meta?.pendingUserRefresh);
  const refreshTitle = manualRefreshPending
    ? t('refreshPendingTitle')
    : t('refresh');
  const refreshDisabled = isFeedRefreshActive || (!isReadLaterView && manualRefreshPending);
  const userInitials = getUserInitials(currentUser?.user?.username);
  const socketSubscription = useMemo(() => ({
    search: debouncedSearch,
    sourceIds: activeFilters.sourceIds,
    topics: activeFilters.topics,
    excludedSourceIds,
    excludedSubSourceIds
  }), [activeFilters.sourceIds, activeFilters.topics, debouncedSearch, excludedSourceIds, excludedSubSourceIds]);

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
    setReadThematicSummaryIds(getStoredReadThematicSummaryIds(readThematicSummariesStorageKey));
  }, [readThematicSummariesStorageKey]);

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
    const tracksListLoading = !append && !silent;

    if (tracksListLoading) {
      activeListLoadingRequestIdRef.current = request.id;
    } else if (!append && silent && activeListLoadingRequestIdRef.current !== null) {
      activeListLoadingRequestIdRef.current = null;
      setLoading(false);
    }

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
      const baseRequestParams = {
        activeFilters: {
          sourceIds: activeFilters.sourceIds,
          topics: activeFilters.topics,
        },
        search: debouncedSearch,
        signal: request.signal,
      };
      const response = await (isReadLaterView ? fetchReadLaterNews : fetchNews)(buildFeedRequestParams({
        ...baseRequestParams,
        append,
        cursor,
        forceRefresh,
        includeFilters: !append && !silent,
        isReadLaterView,
        page,
        pageSize: responsePageSize,
      }));

      if (!request.isLatest()) {
        return;
      }

      const targetItemCount = append ? 0 : minimumItemCount;
      const mergedItems = response.items || [];
      let nextMeta = response.meta || null;

      while (
        !append
        && !isReadLaterView
        && mergedItems.length < targetItemCount
        && nextMeta?.hasMore
        && nextMeta?.nextCursor
      ) {
        const nextPage = await fetchNews(buildFeedRequestParams({
          ...baseRequestParams,
          append: true,
          cursor: nextMeta.nextCursor,
          forceRefresh: false,
          includeFilters: false,
          isReadLaterView: false,
          page: 1,
          pageSize: Math.min(targetItemCount - mergedItems.length, MAX_TOPIC_RELOAD_PAGE_SIZE),
        }));

        if (!request.isLatest()) {
          return;
        }

        mergedItems.splice(0, mergedItems.length, ...mergeGroups(mergedItems, nextPage.items || []));
        nextMeta = nextPage.meta || nextMeta;
      }

      setNews((current) => {
        const nextNews = getLoadedNewsGroups(current, {
          append,
          isReadLaterView,
          maxRetainedGroups: MAX_RETAINED_NEWS_GROUPS,
          mergedItems,
          responseItems: response.items || [],
          silent,
        });

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
      if (!append && !silent) {
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
      if (tracksListLoading && activeListLoadingRequestIdRef.current === request.id) {
        activeListLoadingRequestIdRef.current = null;
        setLoading(false);
      } else if (!tracksListLoading && request.isLatest()) {
        setBusyState(false);
      }
    }
  }, [activeFilters.sourceIds, activeFilters.topics, cancelPaginationRequest, debouncedSearch, isReadLaterView, startListRequest, startPaginationRequest]);

  const handleTopicRefresh = useCallback((payload = {}) => {
    if (needsSourceSetup) {
      return;
    }

    if (payload.reason === 'news') {
      if (isReadLaterView) {
        return;
      }

      loadNews({ page: 1, append: false });
      return;
    }

    if (activeListLoadingRequestIdRef.current !== null) {
      return;
    }

    const hasVisibleNews = Math.max(visibleNewsCountRef.current, preservedNewsCountRef.current) > 0;
    loadNews({
      page: 1,
      append: false,
      silent: hasVisibleNews,
      minimumItemCount: hasVisibleNews ? Math.max(visibleNewsCountRef.current, preservedNewsCountRef.current) : 0
    });
  }, [isReadLaterView, loadNews, needsSourceSetup]);

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

  const loadThematicSummaries = useCallback(async () => {
    if (needsSourceSetup || !aiSummaryFeatureState.surfaceEnabled) {
      cancelSummaryRequest();
      setThematicSummaries([]);
      return;
    }

    const request = startSummaryRequest();

    try {
      const response = await fetchThematicSummaries({ signal: request.signal });
      if (request.isLatest()) {
        setThematicSummaries(filterThematicSummariesForFeatures(response.items || [], aiSummaryFeatureState));
        const readSummaryIds = mergeReadThematicSummaryIds(
          getStoredReadThematicSummaryIds(readThematicSummariesStorageKey),
          response.readSummaryIds
        );
        setReadThematicSummaryIds(readSummaryIds);
        setStoredReadThematicSummaryIds(readThematicSummariesStorageKey, readSummaryIds);
      }
    } catch (requestError) {
      if (!isRequestCanceled(requestError) && request.isLatest()) {
        setThematicSummaries([]);
      }
    }
  }, [aiSummaryFeatureState, cancelSummaryRequest, needsSourceSetup, readThematicSummariesStorageKey, startSummaryRequest]);

  useTopicRefreshSocket({
    onTopicRefresh: handleTopicRefresh,
    onSummariesRefresh: () => loadThematicSummaries(),
    onNewsUpdate: handleNewsUpdate,
    subscription: socketSubscription,
    enabled: !needsSourceSetup
  });

  useEffect(() => {
    if (needsSourceSetup || !aiSummaryFeatureState.surfaceEnabled) {
      return undefined;
    }

    const refreshVisibleSummaries = () => {
      if (!document.hidden) {
        loadThematicSummaries();
      }
    };

    window.addEventListener('focus', refreshVisibleSummaries);
    document.addEventListener('visibilitychange', refreshVisibleSummaries);

    return () => {
      window.removeEventListener('focus', refreshVisibleSummaries);
      document.removeEventListener('visibilitychange', refreshVisibleSummaries);
    };
  }, [aiSummaryFeatureState.surfaceEnabled, loadThematicSummaries, needsSourceSetup]);

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

  useEffect(() => {
    loadThematicSummaries();
  }, [loadThematicSummaries]);

  const handleManualRefresh = useCallback(() => {
    loadNews({ page: 1, append: false, forceRefresh: true });
  }, [loadNews]);

  const handlePendingNewsRefresh = useCallback(() => {
    loadNews({ page: 1, append: false });
  }, [loadNews]);

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

  const openThematicSummary = useCallback((summary) => {
    if (!summary?.id) {
      return;
    }

    setSelectedThematicSummary(summary);
    const summaryIds = [...new Set(isPodcastSummary(summary)
      ? [summary.id, ...visibleThematicSummaries.filter(isPodcastSummary).map((podcastSummary) => podcastSummary.id)].filter(Boolean)
      : [summary.id])];

    setReadThematicSummaryIds((current) => {
      const unreadSummaryIds = summaryIds.filter((summaryId) => !current.includes(summaryId));

      if (unreadSummaryIds.length === 0) {
        return current;
      }

      const next = [...current, ...unreadSummaryIds];
      setStoredReadThematicSummaryIds(readThematicSummariesStorageKey, next);
      return next;
    });

    markThematicSummariesRead(summaryIds)
      .then((response) => {
        setReadThematicSummaryIds((current) => {
          const next = mergeReadThematicSummaryIds(current, response?.readSummaryIds);
          setStoredReadThematicSummaryIds(readThematicSummariesStorageKey, next);
          return next;
        });
      })
      .catch(() => {});
  }, [readThematicSummariesStorageKey, visibleThematicSummaries]);

  const handleToggleReadLater = useCallback(async (group) => {
    const articleIds = (group?.readLater ? (group.readLaterArticleIds || []) : (group?.items || []).map((item) => item.id)).filter(Boolean);
    if (!group?.id || articleIds.length === 0) {
      return;
    }

    setReadLaterUpdatingGroupIds((current) => [...new Set([...current, group.id])]);
    setError(null);

    try {
      if (group.readLater) {
        await removeReadLaterArticles(articleIds);
        setNews((current) => isReadLaterView
          ? current.filter((item) => item.id !== group.id)
          : current.map((item) => item.id === group.id ? { ...item, readLater: false, readLaterArticleIds: [] } : item));
      } else {
        await saveReadLaterArticles(articleIds);
        setNews((current) => current.map((item) => item.id === group.id ? { ...item, readLater: true, readLaterArticleIds: articleIds } : item));
      }
    } catch (requestError) {
      if (!isRequestCanceled(requestError)) {
        setError(requestError);
      }
    } finally {
      setReadLaterUpdatingGroupIds((current) => current.filter((groupId) => groupId !== group.id));
    }
  }, [isReadLaterView]);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const clearSearch = useCallback(() => {
    setSearch('');
    setDebouncedSearch('');
  }, []);

  const filterSurfaceProps = {
    visibleSources: visibleAvailableSources,
    availableTopics,
    activeFilters,
    search,
    t,
    locale,
    onToggleFilter: toggleFilter,
    onSearchChange: setSearch,
    onSearchClear: clearSearch
  };

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
                {...filterSurfaceProps}
                onToggleReadLater={() => setActiveView((current) => current === 'readLater' ? 'news' : 'readLater')}
                onOpenSurface={() => setUserMenuOpen(false)}
                readLaterActive={isReadLaterView}
                closeSignal={desktopFiltersCloseSignal}
                compact={topNavCompact}
              />

              <div className="relative hidden md:block">
                <TopNavActionButton
                  icon={RefreshCw}
                  label={t('refresh')}
                  onClick={handleManualRefresh}
                  disabled={refreshDisabled}
                  aria-label={refreshTitle}
                  title={refreshTitle}
                  iconClassName={refreshDisabled ? 'animate-spin' : ''}
                />
              </div>

              <div className="relative" ref={userMenuRef}>
                <TopNavActionButton
                  icon={User}
                  iconNode={userInitials ? (
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-200 text-xs font-bold leading-none text-sky-800" aria-hidden="true">
                      {userInitials}
                    </span>
                  ) : (
                    <User className="h-7 w-7" aria-hidden="true" />
                  )}
                  label={null}
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
                  sizeClassName="h-12 w-12 min-w-12 shrink-0 rounded-full px-0"
                  aria-expanded={userMenuOpen}
                  aria-haspopup="menu"
                  aria-label={t('userMenu')}
                />

                {userMenuOpen && (
                  <div className={`absolute right-0 ${topNavCompact ? 'top-[calc(100%+1rem)]' : 'top-[calc(100%+1.625rem)]'} z-50 w-60 overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white/95 shadow-2xl backdrop-blur transition-all duration-200`} role="menu">
                    <div className="space-y-3 p-3">
                      <div className="space-y-2 pt-1">
                        <UserMenuItem
                          icon={Cog}
                          label={t('settings')}
                          onClick={() => {
                            setSettingsOpen(true);
                            setUserMenuOpen(false);
                          }}
                          iconClassName="bg-sky-100 text-sky-700"
                        />
                        <UserMenuItem
                          icon={MessageSquare}
                          label={t('feedbackMenuItem')}
                          onClick={() => {
                            setFeedbackOpen(true);
                            setUserMenuOpen(false);
                          }}
                          iconClassName="bg-emerald-100 text-emerald-700"
                        />
                        <UserMenuItem
                          icon={LogOut}
                          label={t('logout')}
                          onClick={onLogout}
                          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-left text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100"
                          iconClassName="bg-white text-rose-700"
                        />
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
        {!isReadLaterView && visibleThematicSummaries.length > 0 && (
          <ThematicSummaryStories
            summaries={visibleThematicSummaries}
            locale={locale}
            readSummaryIds={readThematicSummaryIds}
            t={t}
            onOpenSummary={openThematicSummary}
          />
        )}

        {loading && !loadingMore ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
          </div>
        ) : error ? (
          <ErrorMessage error={error} onRetry={() => loadNews({ page: 1, append: false, forceRefresh: true })} t={t} />
        ) : visibleNews.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <h2 className="text-xl font-semibold text-slate-800">{isReadLaterView ? t('readLaterEmptyTitle') : t('noNewsTitle')}</h2>
            <p className="mt-2 text-slate-500">{isReadLaterView ? t('readLaterEmptyText') : t('noNewsText')}</p>
          </div>
        ) : (
          <>
            {!isReadLaterView && pendingNewsCount > 0 && (
              <div className="mb-4 flex justify-center">
                <button
                  type="button"
                  aria-live="polite"
                  onClick={handlePendingNewsRefresh}
                  disabled={isFeedRefreshActive}
                  className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 shadow-sm transition-colors hover:border-sky-300 hover:bg-sky-100 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  {t('newArticlesAvailable', { count: pendingNewsCount })}
                </button>
              </div>
            )}

            <div className="grid w-full min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visibleNews.map((group) => (
                <NewsCard
                  key={group.id || group.cursorId || group.items?.[0]?.id}
                  group={group}
                  showImages={showNewsImages}
                  locale={locale}
                  t={t}
                  onOpenReader={openReader}
                  onToggleReadLater={handleToggleReadLater}
                  readLaterUpdating={readLaterUpdatingGroupIds.includes(group.id)}
                />
              ))}
            </div>

            <div className="mt-8 flex justify-center">
              {meta?.hasMore && (isReadLaterView || !retainedNewsLimitReached) ? (
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

      {readerState.isOpen && currentReaderGroup && (
        <ReaderPanel
          group={currentReaderGroup}
          initialArticleId={readerState.articleId}
          readerPosition={currentUser?.settings?.readerPanelPosition || 'right'}
          t={t}
          currentUser={currentUser}
          onClose={closeReader}
        />
      )}

      {displayedThematicSummary && (
        <ThematicSummaryPanel
          summary={displayedThematicSummary}
          summaries={visibleThematicSummaries}
          locale={locale}
          t={t}
          onClose={() => setSelectedThematicSummary(null)}
          onSelectSummary={openThematicSummary}
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

      {!readerState.isOpen && !displayedThematicSummary && !settingsOpen && !feedbackOpen ? (
        <MobileBottomNav
          {...filterSurfaceProps}
          activeView={activeView}
          onRefresh={handleManualRefresh}
          onViewChange={setActiveView}
          refreshActive={refreshDisabled}
          refreshDisabled={refreshDisabled}
          refreshTitle={refreshTitle}
          visible={showMobileNav}
        />
      ) : null}
    </div>
  );
};

export default NewsAggregator;
