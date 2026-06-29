import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BookOpenText,
  Clock3,
  Newspaper,
  RefreshCw,
  Share2
} from 'lucide-react';
import { fetchReaderArticle, isRequestCanceled, updateUserSettings } from '../services/api';
import useLatestRequest from '../hooks/useLatestRequest';
import useShareArticle from '../hooks/useShareArticle';
import { getSafeExternalUrl } from '../utils/urlSafety';
import { FullscreenPanelFrame } from './FullscreenModalFrame';
import ShareStatusBubble from './ShareStatusBubble';
import {
  DEFAULT_READER_TEXT_SIZE,
  READER_TEXT_SIZE_ORDER,
  READER_TEXT_SIZE_STYLES,
  normalizeReaderTextSize
} from '../config/readerTextSize';
import { getStoredReaderTextSizePreference, setStoredReaderTextSizePreference } from '../utils/readerTextSizePreference';

const sourceChipClassName = 'inline-flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1.5 text-xs font-medium text-sky-900';
const readTimeChipClassName = 'inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600';

function getArticleSourceLabel(article) {
  if (!article) {
    return '';
  }

  const source = article.source || article.rawSource || '';
  const subSource = article.subSource && article.subSource !== source ? article.subSource : '';
  return source && subSource ? `${source} - ${subSource}` : (source || subSource);
}

function getSourceVersionItems(items = []) {
  const articleItems = (Array.isArray(items) ? items : []).filter((item) => item?.id);
  const labelCounts = new Map();
  const labelIndexes = new Map();
  const getVersionLabel = (item) => getArticleSourceLabel(item) || item.title || item.id;

  articleItems.forEach((item) => {
    const label = getVersionLabel(item);
    labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
  });

  return articleItems.map((item) => {
    const label = getVersionLabel(item);
    const index = (labelIndexes.get(label) || 0) + 1;
    labelIndexes.set(label, index);

    return {
      item,
      label: labelCounts.get(label) > 1 ? `${label} #${index}` : label
    };
  });
}

function renderReaderBlock(block, index, readerTextStyles) {
  if (!block) {
    return null;
  }

  if (block.type === 'heading') {
    const TagName = `h${Math.min(Math.max(block.level || 2, 1), 6)}`;
    const sizeClass = block.level <= 2
      ? readerTextStyles.headingLevel1
      : block.level === 3
        ? readerTextStyles.headingLevel3
        : readerTextStyles.headingOther;
    return <TagName key={`${block.type}-${index}`} className={`font-semibold leading-tight tracking-tight text-stone-900 ${sizeClass}`}>{block.text}</TagName>;
  }

  if (block.type === 'unordered-list' || block.type === 'ordered-list') {
    const ListTag = block.type === 'ordered-list' ? 'ol' : 'ul';
    const items = Array.isArray(block.items) ? block.items : [];
    if (items.length === 0) {
      return null;
    }

    return (
      <ListTag
        key={`${block.type}-${index}`}
        className={`space-y-3 pl-6 ${readerTextStyles.list} ${block.type === 'ordered-list' ? 'list-decimal' : 'list-disc'}`}
      >
        {items.map((item, itemIndex) => (
          <li key={`${block.type}-${index}-${itemIndex}`}>{item}</li>
        ))}
      </ListTag>
    );
  }

  if (block.type === 'preformatted') {
    return <pre key={`${block.type}-${index}`} className={readerTextStyles.preformatted}>{block.text}</pre>;
  }

  if (block.type === 'blockquote') {
    return <blockquote key={`${block.type}-${index}`} className={readerTextStyles.blockquote}>{block.text}</blockquote>;
  }

  return <p key={`${block.type}-${index}`} className={readerTextStyles.paragraph}>{block.text}</p>;
}

function getReaderGroupKey(group) {
  if (group?.id) {
    return group.id;
  }

  return (Array.isArray(group?.items) ? group.items : [])
    .map((item) => item?.id)
    .filter(Boolean)
    .join('|');
}

const ReaderPanel = ({
  group,
  initialArticleId,
  readerPosition = 'right',
  t,
  onClose,
  currentUser
}) => {
  const [selectedArticleId, setSelectedArticleId] = useState(initialArticleId || group?.items?.[0]?.id || null);
  const [readerByArticleId, setReaderByArticleId] = useState({});
  const readerByArticleIdRef = useRef(readerByArticleId);
  const [loading, setLoading] = useState(false);
  const { shareState, shareArticle, resetShareState } = useShareArticle();
  const [readerTextSize, setReaderTextSize] = useState(() => getStoredReaderTextSizePreference(currentUser?.settings?.readerTextSize));
  const [error, setError] = useState(null);
  const readerTextSizeRequestIdRef = useRef(0);
  const { startLatestRequest, resetLatestRequest } = useLatestRequest();
  const groupKey = useMemo(() => getReaderGroupKey(group), [group]);
  const previousGroupKeyRef = useRef(groupKey);
  const firstGroupArticleId = group?.items?.[0]?.id || null;
  const groupArticleIds = useMemo(() => {
    return new Set((Array.isArray(group?.items) ? group.items : []).map((item) => item?.id).filter(Boolean));
  }, [group?.items]);

  useEffect(() => {
    const groupChanged = previousGroupKeyRef.current !== groupKey;
    const fallbackArticleId = initialArticleId || firstGroupArticleId;

    previousGroupKeyRef.current = groupKey;

    setSelectedArticleId((currentArticleId) => {
      if (!groupChanged && currentArticleId && groupArticleIds.has(currentArticleId)) {
        return currentArticleId;
      }

      return fallbackArticleId;
    });
    setError(null);

    if (groupChanged) {
      resetShareState();
      resetLatestRequest();
    }
  }, [firstGroupArticleId, groupArticleIds, groupKey, initialArticleId, resetLatestRequest, resetShareState]);

  useEffect(() => {
    setReaderTextSize(getStoredReaderTextSizePreference(currentUser?.settings?.readerTextSize));
  }, [currentUser?.settings?.readerTextSize]);

  const selectedArticle = useMemo(() => {
    return group?.items?.find((item) => item.id === selectedArticleId) || group?.items?.[0] || null;
  }, [group?.items, selectedArticleId]);

  const sourceVersionItems = useMemo(() => {
    return getSourceVersionItems(group?.items || []);
  }, [group?.items]);

  const selectedReader = selectedArticleId ? readerByArticleId[selectedArticleId] : null;

  useEffect(() => {
    readerByArticleIdRef.current = readerByArticleId;
  }, [readerByArticleId]);

  const loadReader = useCallback(async (articleId, { forceRefresh = false } = {}) => {
    if (!articleId) {
      return;
    }

    if (!forceRefresh && readerByArticleIdRef.current[articleId]) {
      resetLatestRequest();
      setLoading(false);
      setError(null);
      return;
    }

    setError(null);

    const request = startLatestRequest();

    setLoading(true);

    try {
      const payload = await fetchReaderArticle(articleId, {
        refresh: forceRefresh,
        signal: request.signal
      });

      if (!request.isLatest()) {
        return;
      }

      setReaderByArticleId((current) => {
        const next = {
          ...current,
          [articleId]: payload
        };
        readerByArticleIdRef.current = next;
        return next;
      });
    } catch (requestError) {
      if (!isRequestCanceled(requestError) && request.isLatest()) {
        setError(requestError);
      }
    } finally {
      if (request.isLatest()) {
        setLoading(false);
      }
    }
  }, [resetLatestRequest, startLatestRequest]);

  useEffect(() => {
    if (selectedArticleId) {
      loadReader(selectedArticleId);
    }
  }, [loadReader, selectedArticleId]);

  const safeOriginalUrl = getSafeExternalUrl(selectedArticle?.url);
  const desktopPositionClassName = readerPosition === 'left'
    ? 'lg:justify-start'
    : (readerPosition === 'center' ? 'lg:justify-center' : 'lg:justify-end');
  const readerTextStyles = READER_TEXT_SIZE_STYLES[readerTextSize] || READER_TEXT_SIZE_STYLES[DEFAULT_READER_TEXT_SIZE];
  const readerTextSizeIndex = Math.max(READER_TEXT_SIZE_ORDER.indexOf(readerTextSize), 0);
  const handleShare = useCallback(async () => {
    await shareArticle({
      url: safeOriginalUrl,
      title: selectedArticle?.title || ''
    });
  }, [safeOriginalUrl, selectedArticle?.title, shareArticle]);

  const updateReaderTextSize = useCallback(async (nextValue) => {
    const normalizedNextValue = normalizeReaderTextSize(nextValue);
    if (normalizedNextValue === readerTextSize) {
      return;
    }

    const previousValue = readerTextSize;
    const persistedValue = setStoredReaderTextSizePreference(normalizedNextValue);
    setReaderTextSize(persistedValue);

    if (!currentUser?.settings) {
      return;
    }

    const requestId = readerTextSizeRequestIdRef.current + 1;
    readerTextSizeRequestIdRef.current = requestId;

    try {
      await updateUserSettings({ readerTextSize: persistedValue });
      if (readerTextSizeRequestIdRef.current !== requestId) {
        return;
      }
    } catch {
      if (readerTextSizeRequestIdRef.current === requestId) {
        setStoredReaderTextSizePreference(previousValue);
        setReaderTextSize(previousValue);
      }
    }
  }, [currentUser?.settings, readerTextSize]);

  const decreaseReaderTextSize = useCallback(() => {
    const nextIndex = Math.max(readerTextSizeIndex - 1, 0);
    updateReaderTextSize(READER_TEXT_SIZE_ORDER[nextIndex]);
  }, [readerTextSizeIndex, updateReaderTextSize]);

  const increaseReaderTextSize = useCallback(() => {
    const nextIndex = Math.min(readerTextSizeIndex + 1, READER_TEXT_SIZE_ORDER.length - 1);
    updateReaderTextSize(READER_TEXT_SIZE_ORDER[nextIndex]);
  }, [readerTextSizeIndex, updateReaderTextSize]);

  const refreshReader = useCallback(() => {
    if (!selectedArticleId || loading) {
      return;
    }

    loadReader(selectedArticleId, { forceRefresh: true });
  }, [loadReader, loading, selectedArticleId]);

  const headerStart = (
    <div className="flex items-center gap-2">
      <div className="relative inline-flex items-center">
        <ShareStatusBubble
          shareState={shareState}
          t={t}
          className="share-status-pill-from-button mr-2 max-w-[min(18rem,calc(100vw-6rem))]"
        />
        <button
          type="button"
          onClick={handleShare}
          disabled={!safeOriginalUrl}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-white text-slate-700 shadow-sm transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={t('shareArticle')}
        >
          <Share2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex h-11 items-center gap-1 rounded-full border border-stone-300 bg-white px-1.5 shadow-sm">
        <button
          type="button"
          onClick={decreaseReaderTextSize}
          disabled={readerTextSizeIndex === 0}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-lg font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={t('decreaseReaderTextSize')}
          title={t('decreaseReaderTextSize')}
        >
          -
        </button>
        <span
          className="min-w-[2.5rem] text-center text-sm font-semibold tracking-[0.08em] text-stone-500"
          aria-hidden="true"
        >
          aA
        </span>
        <button
          type="button"
          onClick={increaseReaderTextSize}
          disabled={readerTextSizeIndex === READER_TEXT_SIZE_ORDER.length - 1}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-lg font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={t('increaseReaderTextSize')}
          title={t('increaseReaderTextSize')}
        >
          +
        </button>
      </div>

      <button
        type="button"
        onClick={refreshReader}
        disabled={!selectedArticleId || loading}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-white text-slate-700 shadow-sm transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
        aria-label={t('refreshReader')}
        title={t('refreshReader')}
      >
        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );

  return (
    <FullscreenPanelFrame
      closeLabel={t('closeReader')}
      containerClassName={`relative flex h-full w-full ${desktopPositionClassName}`}
      headerStart={headerStart}
      onClose={onClose}
      panelClassName="flex h-full w-full flex-col bg-slate-50 shadow-2xl lg:m-4 lg:h-[calc(100dvh-2rem)] lg:w-[min(72rem,calc(100vw-2rem))] lg:overflow-hidden lg:rounded-[2rem] lg:border lg:border-slate-200/80"
    >
          {sourceVersionItems.length > 1 && (
            <div className="border-b border-stone-200/80 bg-white/70 px-5 py-4 backdrop-blur-sm md:px-6">
              <p className="mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
                <Newspaper className="h-4 w-4" />
                {t('sourceVersions')}
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-300 [&::-webkit-scrollbar-track]:bg-transparent">
                {sourceVersionItems.map(({ item, label }) => {
                  const isActive = item.id === selectedArticle?.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedArticleId(item.id)}
                      aria-pressed={isActive}
                      className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                        isActive
                          ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                          : 'border-stone-200 bg-stone-50 text-stone-700 hover:bg-stone-100'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto bg-slate-50 px-4 py-6 md:px-5 md:py-8 lg:px-6">
            {selectedArticle && (
              <div className="mx-auto max-w-[58rem] space-y-5">
                <div className="rounded-[2rem] border border-stone-200/80 bg-white/85 px-6 py-6 shadow-sm backdrop-blur-sm md:px-8 md:py-7">
                  <h2 className="text-2xl font-semibold leading-tight tracking-tight text-stone-900 md:text-[2rem] md:leading-[1.15]">
                    {selectedArticle?.title || t('readerMode')}
                  </h2>

                  <div className="mt-5 flex flex-wrap items-center gap-2 sm:gap-3">
                    <span className={sourceChipClassName}>
                      <Newspaper className="h-3.5 w-3.5" />
                      <span className="truncate">{getArticleSourceLabel(selectedArticle)}</span>
                    </span>
                    {selectedReader?.minutesToRead && (
                      <span className={readTimeChipClassName}>
                        <Clock3 className="h-3.5 w-3.5" />
                        {t('readTime', { minutes: selectedReader.minutesToRead })}
                      </span>
                    )}
                  </div>
                </div>

                {loading && !selectedReader ? (
                  <div className="rounded-[2rem] border border-stone-200/80 bg-white/90 px-6 py-12 text-center shadow-sm backdrop-blur-sm">
                    <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-stone-200 border-t-slate-900" />
                    <p className="mt-4 inline-flex items-center gap-2 text-sm text-stone-500">
                      <BookOpenText className="h-4 w-4" />
                      {t('loadingReader')}
                    </p>
                  </div>
                ) : error && !selectedReader ? (
                  <div className="rounded-[2rem] border border-red-200 bg-red-50/95 px-6 py-8 text-center text-red-700 shadow-sm">
                    <p className="inline-flex items-center gap-2 font-medium">
                      <AlertCircle className="h-4 w-4" />
                      {t('readerUnavailable')}
                    </p>
                  </div>
                ) : selectedReader ? (
                  <article className="rounded-[2rem] border border-stone-200/80 bg-white/95 px-6 py-8 shadow-[0_24px_70px_rgba(15,23,42,0.08)] md:px-10 md:py-10">
                    {error && (
                      <div className="mb-8 inline-flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50/95 px-4 py-3 text-sm text-amber-800 shadow-sm">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        {t('readerUnavailable')}
                      </div>
                    )}

                    {selectedReader.fallback && (
                      <div className="mb-8 inline-flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50/95 px-4 py-3 text-sm text-amber-800 shadow-sm">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        {t('readerFallback')}
                      </div>
                    )}

                    {selectedReader.byline && (
                      <p className="mb-8 text-sm font-medium uppercase tracking-[0.16em] text-stone-400">{selectedReader.byline}</p>
                    )}

                    <div className="space-y-7 tracking-[0.01em]">
                      {(selectedReader.contentBlocks || []).map((block, index) => renderReaderBlock(block, index, readerTextStyles))}
                    </div>
                  </article>
                ) : null}
              </div>
            )}
          </div>
    </FullscreenPanelFrame>
  );
};

export default ReaderPanel;
