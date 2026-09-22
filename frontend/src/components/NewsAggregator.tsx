import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Cog,
  LogOut,
  MessageSquare,
  RefreshCw,
  Rss,
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
import useTopicRefreshSocket, { type NewsUpdatePayload } from '../hooks/useTopicRefreshSocket';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import { setStoredReaderTextSizePreference, setStoredReaderTextWidthPreference } from '../utils/readerPreferences';
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
import type { LucideIcon } from 'lucide-react';
import type { ActiveFilters, AvailableTopic, CurrentUser, FeedCursor, FeedMeta, Locale, NewsGroup, NewsSource, ThematicSummary, Translator } from '../types';

const PAGE_SIZE = 12;
const MAX_TOPIC_RELOAD_PAGE_SIZE = 30;
const MAX_RETAINED_NEWS_GROUPS = 72;
const SEARCH_DEBOUNCE_MS = 350;
const EMPTY_FILTERS: ActiveFilters = { sourceIds: [], topics: [] };
const BACK_TO_TOP_THRESHOLD = 280;
const TOP_NAV_SHRINK_THRESHOLD = 28;
const MOBILE_NAV_REVEAL_SCROLL_DELTA = 24;
const MOBILE_NAV_SHOW_DELAY_MS = 250;
const LOAD_MORE_DELAY_MS = 3000;
const SKELETON_CARD_COUNT = 6;

function NewsCardSkeleton({ showImage }: { showImage: boolean }) {
  return (
    <article className="relative flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface md:h-full" aria-hidden="true">
      <div className="flex min-w-0 items-center gap-2 px-4 pt-4 sm:gap-3 sm:px-5 sm:pt-5">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <div className="h-8 w-8 shrink-0 rounded-full bg-sky-100 sm:h-9 sm:w-9" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-2/5 rounded-full bg-surface-inset" />
            <div className="h-3 w-3/5 rounded-full bg-surface-raised" />
          </div>
        </div>
      </div>
      <div className="space-y-3 px-4 py-4 sm:px-5 md:min-h-22">
        <div className="h-4 w-full rounded-full bg-surface-inset" />
        <div className="h-4 w-4/5 rounded-full bg-surface-inset" />
      </div>
      {showImage ? (
        <div className="mt-auto aspect-video w-full border-y border-line-soft bg-surface-inset" />
      ) : null}
      <div className="mt-auto flex items-center justify-between gap-2 px-3 py-2 sm:px-4">
        <div className="flex -space-x-2">
          <div className="h-8 w-8 rounded-full bg-sky-100" />
          <div className="h-8 w-8 rounded-full bg-violet-100" />
        </div>
        <div className="flex gap-1.5 sm:gap-2">
          <div className="h-11 w-11 rounded-xl border border-line" />
          <div className="h-11 w-11 rounded-xl border border-line" />
          <div className="h-11 w-11 rounded-xl border border-line" />
        </div>
      </div>
    </article>
  );
}

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

function UserMenuItem({ icon: Icon, label, onClick, className = '', iconClassName }: { icon: LucideIcon; label: string; onClick: () => void; className?: string; iconClassName: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={className || 'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-ink-body transition-colors hover:bg-hover-soft'}
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

function getCurrentThematicSummarySelection(selectedSummary: ThematicSummary | null, summaries: ThematicSummary[] = []) {
  if (!selectedSummary?.id) {
    return null;
  }

  const sameIdSummary = summaries.find((summary) => summary?.id === selectedSummary.id);
  if (sameIdSummary) {
    return sameIdSummary;
  }

  return summaries.find((summary) => summary?.topicKey === selectedSummary.topicKey) || null;
}

const NewsAggregator = ({ currentUser, locale, t, onLogout, patchSession }: {
  currentUser: CurrentUser;
  locale: Locale;
  t: Translator;
  onLogout: () => void;
  patchSession: (patch: Partial<CurrentUser>) => void;
}) => {
  const needsSourceSetup = currentUser?.settings?.sourceSetupCompleted === false && !currentUser?.user?.isAdmin;
  const showNewsImages = currentUser?.settings?.showNewsImages !== false;
  const feedbackEnabled = currentUser?.features?.feedback?.enabled === true;
  const scrollFrameRef = useRef<number | null>(null);
  const mobileNavShowTimeoutRef = useRef<number | null>(null);
  const mobileNavVisibleRef = useRef(true);
  const mobileNavRevealStartYRef = useRef(0);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreTimeoutRef = useRef<number | null>(null);
  const { startLatestRequest: startListRequest } = useLatestRequest();
  const { startLatestRequest: startPaginationRequest, cancelLatestRequest: cancelPaginationRequest } = useLatestRequest();
  const { startLatestRequest: startSummaryRequest, cancelLatestRequest: cancelSummaryRequest } = useLatestRequest();

  const [news, setNews] = useState<NewsGroup[]>([]);
  const [meta, setMeta] = useState<FeedMeta | null>(null);
  const [availableSources, setAvailableSources] = useState<NewsSource[]>([]);
  const [sourceCatalog, setSourceCatalog] = useState<NewsSource[]>([]);
  const [availableTopics, setAvailableTopics] = useState<AvailableTopic[]>([]);
  const [loading, setLoading] = useState(() => !needsSourceSetup);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(EMPTY_FILTERS);
  const [activeView, setActiveView] = useState<'news' | 'readLater'>('news');
  const [readerState, setReaderState] = useState<{ group: NewsGroup | null; articleId?: string | null }>({ group: null, articleId: null });
  const [thematicSummaries, setThematicSummaries] = useState<ThematicSummary[]>([]);
  const [selectedThematicSummary, setSelectedThematicSummary] = useState<ThematicSummary | null>(null);
  const [readThematicSummaryIds, setReadThematicSummaryIds] = useState(() => getStoredReadThematicSummaryIds(getReadThematicSummariesStorageKey(currentUser)));
  const [accountPanel, setAccountPanel] = useState<'feedNews' | 'settings' | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [pendingNewsGroupIds, setPendingNewsGroupIds] = useState<string[]>([]);
  const [desktopFiltersCloseSignal, setDesktopFiltersCloseSignal] = useState(0);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [showMobileBackToTop, setShowMobileBackToTop] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(true);
  const [topNavCompact, setTopNavCompact] = useState(false);
  const [readLaterUpdatingGroupIds, setReadLaterUpdatingGroupIds] = useState<string[]>([]);
  const lastScrollY = useRef(0);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userMenuButtonRef = useRef<HTMLButtonElement>(null);
  const visibleNewsCountRef = useRef(0);
  const preservedNewsCountRef = useRef(0);
  const activeListLoadingRequestIdRef = useRef<number | null>(null);
  const pendingListRefreshRef = useRef(false);
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
  const canLoadMore = Boolean(meta?.hasMore && (isReadLaterView || !retainedNewsLimitReached));
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const setupSourceCatalog = Array.isArray(currentUser?.sourceCatalog) && currentUser.sourceCatalog.length > 0
    ? currentUser.sourceCatalog
    : sourceCatalog;
  const readThematicSummariesStorageKey = useMemo(() => getReadThematicSummariesStorageKey(currentUser), [currentUser]);
  const thematicSummariesEnabled = currentUser?.features?.ai?.thematicSummariesEnabled !== false;
  const visibleThematicSummaries = useMemo(() => {
    return thematicSummariesEnabled ? thematicSummaries : [];
  }, [thematicSummariesEnabled, thematicSummaries]);
  const displayedThematicSummary = useMemo(() => {
    if (!selectedThematicSummary?.id) {
      return null;
    }

    return getCurrentThematicSummarySelection(selectedThematicSummary, visibleThematicSummaries);
  }, [selectedThematicSummary, visibleThematicSummaries]);
  const currentReaderGroup = useMemo(() => {
    if (!readerState.group) {
      return null;
    }

    const readerGroupKeys = getGroupMergeKeys(readerState.group);
    return news.find((group) => groupSharesAnyKey(group, readerGroupKeys)) || readerState.group;
  }, [news, readerState.group]);

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
    setReadThematicSummaryIds(getStoredReadThematicSummaryIds(readThematicSummariesStorageKey));
  }, [readThematicSummariesStorageKey]);

  useEffect(() => {
    setStoredReaderTextSizePreference(currentUser?.settings?.readerTextSize);
  }, [currentUser?.settings?.readerTextSize]);

  useEffect(() => {
    setStoredReaderTextWidthPreference(currentUser?.settings?.readerTextWidth);
  }, [currentUser?.settings?.readerTextWidth]);

  useEffect(() => {
    const handleScroll = () => {
      if (scrollFrameRef.current) {
        return;
      }

      scrollFrameRef.current = window.requestAnimationFrame(() => {
        const currentY = window.scrollY;
        const nextShowBackToTop = currentY > BACK_TO_TOP_THRESHOLD;
        const nextShowMobileBackToTop = currentY > 0;
        const nextTopNavCompact = currentY > TOP_NAV_SHRINK_THRESHOLD;
        const scrollingDown = currentY > lastScrollY.current;
        const shouldHideMobileNav = scrollingDown && currentY > 50;
        const shouldShowMobileNav = !scrollingDown && (
          currentY <= 50 || mobileNavRevealStartYRef.current - currentY >= MOBILE_NAV_REVEAL_SCROLL_DELTA
        );

        setShowBackToTop((current) => (current === nextShowBackToTop ? current : nextShowBackToTop));
        setShowMobileBackToTop((current) => (current === nextShowMobileBackToTop ? current : nextShowMobileBackToTop));
        setTopNavCompact((current) => (current === nextTopNavCompact ? current : nextTopNavCompact));
        setUserMenuOpen((current) => (current ? false : current));
        if (shouldShowMobileNav) {
          if (!mobileNavVisibleRef.current && !mobileNavShowTimeoutRef.current) {
            mobileNavShowTimeoutRef.current = window.setTimeout(() => {
              mobileNavVisibleRef.current = true;
              mobileNavShowTimeoutRef.current = null;
              setShowMobileNav(true);
            }, MOBILE_NAV_SHOW_DELAY_MS);
          }
        } else if (shouldHideMobileNav) {
          if (mobileNavShowTimeoutRef.current) {
            window.clearTimeout(mobileNavShowTimeoutRef.current);
            mobileNavShowTimeoutRef.current = null;
          }
          mobileNavRevealStartYRef.current = currentY;
          mobileNavVisibleRef.current = false;
          setShowMobileNav(false);
        }
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
      if (mobileNavShowTimeoutRef.current) {
        window.clearTimeout(mobileNavShowTimeoutRef.current);
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
    const validSourceIds = new Set(availableSources.map((source) => source.id));
    setActiveFilters((current) => {
      const nextSourceIds = current.sourceIds.filter((sourceId) => validSourceIds.has(sourceId));
      return nextSourceIds.length === current.sourceIds.length
        ? current
        : { ...current, sourceIds: nextSourceIds };
    });
  }, [availableSources]);

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
  }: { page?: number; append?: boolean; cursor?: FeedCursor | null; forceRefresh?: boolean; silent?: boolean; minimumItemCount?: number } = {}) {
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

        if (pendingListRefreshRef.current) {
          pendingListRefreshRef.current = false;
          const hasVisibleNews = Math.max(visibleNewsCountRef.current, preservedNewsCountRef.current) > 0;
          void loadNewsRequest({
            page: 1,
            append: false,
            silent: hasVisibleNews,
            minimumItemCount: hasVisibleNews ? Math.max(visibleNewsCountRef.current, preservedNewsCountRef.current) : 0
          });
        }
      } else if (!tracksListLoading && request.isLatest()) {
        setBusyState(false);
      }
    }
  }, [activeFilters.sourceIds, activeFilters.topics, cancelPaginationRequest, debouncedSearch, isReadLaterView, startListRequest, startPaginationRequest]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !canLoadMore || loading || loadingMore) {
      return undefined;
    }

    const clearLoadMoreTimeout = () => {
      if (loadMoreTimeoutRef.current) {
        window.clearTimeout(loadMoreTimeoutRef.current);
        loadMoreTimeoutRef.current = null;
      }
    };
    const observer = new globalThis.IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) {
        clearLoadMoreTimeout();
        return;
      }
      if (loadMoreTimeoutRef.current) {
        return;
      }

      loadMoreTimeoutRef.current = window.setTimeout(() => {
        loadMoreTimeoutRef.current = null;
        loadNews(meta?.nextCursor
          ? { append: true, cursor: meta.nextCursor }
          : { page: (meta?.page || 1) + 1, append: true });
      }, LOAD_MORE_DELAY_MS);
    });

    observer.observe(sentinel);
    return () => {
      observer.disconnect();
      clearLoadMoreTimeout();
    };
  }, [canLoadMore, loadNews, loading, loadingMore, meta?.nextCursor, meta?.page]);

  const handleTopicRefresh = useCallback((payload: NewsUpdatePayload = {}) => {
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
      pendingListRefreshRef.current = true;
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

  const handleNewsUpdate = useCallback((payload: NewsUpdatePayload = {}) => {
    const incomingGroupIds = (Array.isArray(payload.groupIds) ? payload.groupIds : []).filter((groupId): groupId is string => Boolean(groupId));

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
    if (needsSourceSetup || !thematicSummariesEnabled) {
      cancelSummaryRequest();
      setThematicSummaries([]);
      return;
    }

    const request = startSummaryRequest();

    try {
      const response = await fetchThematicSummaries({ signal: request.signal });
      if (request.isLatest()) {
        setThematicSummaries(Array.isArray(response.items) ? response.items : []);
        const readSummaryIds = mergeReadThematicSummaryIds(
          getStoredReadThematicSummaryIds(readThematicSummariesStorageKey),
          response.readSummaryIds || []
        );
        setReadThematicSummaryIds(readSummaryIds);
        setStoredReadThematicSummaryIds(readThematicSummariesStorageKey, readSummaryIds);
      }
    } catch {
      // Keep the last successful snapshot during transient refresh failures.
    }
  }, [thematicSummariesEnabled, cancelSummaryRequest, needsSourceSetup, readThematicSummariesStorageKey, startSummaryRequest]);

  useTopicRefreshSocket({
    onTopicRefresh: handleTopicRefresh,
    onSummariesRefresh: loadThematicSummaries,
    onNewsUpdate: handleNewsUpdate,
    subscription: socketSubscription,
    enabled: !needsSourceSetup
  });

  useEffect(() => {
    if (needsSourceSetup || !thematicSummariesEnabled) {
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
  }, [thematicSummariesEnabled, loadThematicSummaries, needsSourceSetup]);

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

  const toggleFilter = useCallback((type: keyof ActiveFilters, value: string) => {
    setActiveFilters((current) => {
      const values = current[type] || [];
      const exists = values.includes(value);

      return {
        ...current,
        [type]: exists ? values.filter((item) => item !== value) : [...values, value]
      };
    });
  }, []);

  const clearFilter = useCallback((type: keyof ActiveFilters) => {
    setActiveFilters((current) => ({ ...current, [type]: [] }));
  }, []);

  const openReader = useCallback((group: NewsGroup, articleId?: string) => {
    setReaderState({ group, articleId });
  }, []);

  const closeReader = useCallback(() => {
    setReaderState({ group: null, articleId: null });
  }, []);

  const openThematicSummary = useCallback((summary: ThematicSummary) => {
    if (!summary?.id) {
      return;
    }

    setSelectedThematicSummary(summary);
    const summaryIds = [summary.id];

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
          const next = mergeReadThematicSummaryIds(current, response?.readSummaryIds || []);
          setStoredReadThematicSummaryIds(readThematicSummariesStorageKey, next);
          return next;
        });
      })
      .catch(() => {});
  }, [readThematicSummariesStorageKey]);

  const handleToggleReadLater = useCallback(async (group: NewsGroup) => {
    const articleIds = (group?.readLater ? (group.readLaterArticleIds || []) : (group?.items || []).map((item) => item.id)).filter((articleId): articleId is string => Boolean(articleId));
    if (!group?.id || articleIds.length === 0) {
      return;
    }

    const groupId = group.id;
    setReadLaterUpdatingGroupIds((current) => [...new Set([...current, groupId])]);
    setError(null);

    try {
      if (group.readLater) {
        await removeReadLaterArticles(articleIds);
        setNews((current) => isReadLaterView
          ? current.filter((item) => item.id !== groupId)
          : current.map((item) => item.id === groupId ? { ...item, readLater: false, readLaterArticleIds: [] } : item));
      } else {
        await saveReadLaterArticles(articleIds);
        setNews((current) => current.map((item) => item.id === groupId ? { ...item, readLater: true, readLaterArticleIds: articleIds } : item));
      }
    } catch (requestError) {
      if (!isRequestCanceled(requestError)) {
        setError(requestError);
      }
    } finally {
      setReadLaterUpdatingGroupIds((current) => current.filter((currentGroupId) => currentGroupId !== groupId));
    }
  }, [isReadLaterView]);

  const scrollToTop = useCallback(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
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
    onClearFilter: clearFilter,
    onToggleFilter: toggleFilter,
    onSearchChange: setSearch,
    onSearchClear: clearSearch
  };

  return (
    <div className="min-h-screen overflow-x-clip bg-canvas text-ink-heading">
      <header className="sticky top-0 z-50 bg-surface pt-[env(safe-area-inset-top)]">
        <div className="border-b border-line">
          <div className={`mx-auto flex max-w-7xl flex-col px-4 transition-[padding] duration-200 lg:px-6 ${topNavCompact ? 'py-2' : 'py-3'}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <BrandMark className="h-9 w-9 shrink-0" />
                  <div className="min-w-0">
                    <h1 className="truncate text-xl font-semibold tracking-tight focus:outline-none" data-focus-fallback tabIndex={-1}>{t('pageTitle')}</h1>
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
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-200 text-xs font-bold leading-none text-sky-800" aria-hidden="true">
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
                    buttonRef={userMenuButtonRef}
                    className="z-20"
                    sizeClassName="h-11 w-11 min-w-11 shrink-0 rounded-xl px-0"
                    aria-expanded={userMenuOpen}
                    aria-haspopup="menu"
                    aria-label={t('userMenu')}
                  />

                  {userMenuOpen && (
                    <div className="ui-popover absolute right-0 top-[calc(100%+0.75rem)] z-50 w-60" role="menu">
                      <div className="p-2">
                        <div className="space-y-1">
                          <UserMenuItem
                            icon={Rss}
                            label={t('addFeedNews')}
                            onClick={() => {
                              setAccountPanel('feedNews');
                              setUserMenuOpen(false);
                            }}
                            iconClassName="bg-emerald-100 text-emerald-700"
                          />
                          <UserMenuItem
                            icon={Cog}
                            label={t('settings')}
                            onClick={() => {
                              setAccountPanel('settings');
                              setUserMenuOpen(false);
                            }}
                            iconClassName="bg-sky-100 text-sky-700"
                          />
                          {feedbackEnabled && (
                            <UserMenuItem
                              icon={MessageSquare}
                              label={t('feedbackMenuItem')}
                              onClick={() => {
                                setFeedbackOpen(true);
                                setUserMenuOpen(false);
                              }}
                              iconClassName="bg-emerald-100 text-emerald-700"
                            />
                          )}
                          <UserMenuItem
                            icon={LogOut}
                            label={t('logout')}
                            onClick={onLogout}
                            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100"
                            iconClassName="bg-rose-50 text-rose-700"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 pb-28 md:pb-10 lg:px-6">
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
          <div
            className="grid w-full min-w-0 animate-pulse grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
            role="status"
            aria-label={t('loadingMore')}
          >
            {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
              <NewsCardSkeleton key={index} showImage={showNewsImages} />
            ))}
          </div>
        ) : error ? (
          <ErrorMessage error={error} onRetry={() => loadNews({ page: 1, append: false, forceRefresh: true })} t={t} />
        ) : visibleNews.length === 0 ? (
          <div className="rounded-2xl border border-line bg-surface px-6 py-12 text-center">
            <h2 className="text-xl font-semibold text-ink-emphasis">{isReadLaterView ? t('readLaterEmptyTitle') : t('noNewsTitle')}</h2>
            <p className="mt-2 text-ink-subtle">{isReadLaterView ? t('readLaterEmptyText') : t('noNewsText')}</p>
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

            <div className="grid w-full min-w-0 grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {visibleNews.map((group) => (
                <div key={group.id || group.cursorId || group.items?.[0]?.id} className="feed-card-enter md:h-full">
                  <NewsCard
                    group={group}
                    showImages={showNewsImages}
                    locale={locale}
                    t={t}
                    onOpenReader={openReader}
                    onToggleReadLater={handleToggleReadLater}
                    readLaterUpdating={Boolean(group.id && readLaterUpdatingGroupIds.includes(group.id))}
                  />
                </div>
              ))}
            </div>

            <div className="mt-8 flex min-h-12 justify-center">
              {canLoadMore ? (
                <div
                  ref={loadMoreSentinelRef}
                  className="inline-flex items-center px-5 py-3 text-sm font-medium text-ink-subtle"
                  role="status"
                  aria-label={t('loadingMore')}
                >
                  <span className="inline-flex h-4 items-end gap-1" aria-hidden="true">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-sky-500 [animation-delay:-300ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-violet-500 [animation-delay:-150ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-500" />
                  </span>
                </div>
              ) : (
                <p className="text-sm text-ink-subtle">{t('noMoreResults')}</p>
              )}
            </div>
          </>
        )}
      </main>

      {currentReaderGroup && (
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
          currentUser={currentUser}
          locale={locale}
          t={t}
          onClose={() => setSelectedThematicSummary(null)}
          onSelectSummary={openThematicSummary}
          showOpeningSkeleton
        />
      )}

      {accountPanel && (
        <SettingsPanel
          t={t}
          currentUser={currentUser}
          availableSources={sourceCatalog}
          onClose={() => setAccountPanel(null)}
          patchSession={patchSession}
          restoreFocusRef={userMenuButtonRef}
          view={accountPanel}
        />
      )}

      {feedbackEnabled && feedbackOpen && (
        <FeedbackModal
          t={t}
          feedbackLimits={currentUser?.limits}
          onClose={() => setFeedbackOpen(false)}
          restoreFocusRef={userMenuButtonRef}
        />
      )}

      {needsSourceSetup && (
        <SourceSetupWizard
          t={t}
          sources={setupSourceCatalog}
          currentSettings={currentUser.settings}
          patchSession={patchSession}
        />
      )}

      <button
        type="button"
        onClick={scrollToTop}
        className={`ui-icon-button fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-[calc(1.5rem+env(safe-area-inset-left))] z-40 hidden shadow-sm transition-all duration-200 md:inline-flex ${
          showBackToTop
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-3 opacity-0'
        }`}
        disabled={!showBackToTop}
        tabIndex={showBackToTop ? 0 : -1}
        aria-hidden={!showBackToTop}
        aria-label={t('backToTop')}
      >
        <ArrowUp className="h-5 w-5" aria-hidden="true" />
      </button>

      {!currentReaderGroup && !displayedThematicSummary && !accountPanel && !feedbackOpen && !needsSourceSetup ? (
        <MobileBottomNav
          {...filterSurfaceProps}
          activeView={activeView}
          onRefresh={handleManualRefresh}
          onViewChange={setActiveView}
          refreshActive={refreshDisabled}
          refreshDisabled={refreshDisabled}
          refreshTitle={refreshTitle}
          visible={showMobileNav}
          backToTopVisible={showMobileBackToTop}
          onBackToTop={scrollToTop}
        />
      ) : null}
    </div>
  );
};

export default NewsAggregator;
