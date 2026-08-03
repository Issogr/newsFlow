import { useCallback, useEffect, useMemo, useRef, useState, type ElementType } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Clock3,
  Newspaper,
  RefreshCw,
  Share2
} from 'lucide-react';
import { fetchReaderArticle, isRequestCanceled } from '../services/api';
import useLatestRequest from '../hooks/useLatestRequest';
import useShareArticle from '../hooks/useShareArticle';
import { getSafeExternalUrl } from '../utils/urlSafety';
import { FullscreenPanelFrame } from './FullscreenModalFrame';
import ReaderTextSizeControls from './ReaderTextSizeControls';
import ReaderTextWidthControls from './ReaderTextWidthControls';
import ShareStatusBubble from './ShareStatusBubble';
import TextContentSkeleton from './TextContentSkeleton';
import {
  DEFAULT_READER_TEXT_SIZE,
  READER_TEXT_SIZE_STYLES
} from '../config/readerTextSize';
import { DEFAULT_READER_TEXT_WIDTH, READER_TEXT_WIDTH_CLASS_NAMES } from '../config/readerTextWidth';
import { getStoredReaderTextSizePreference, getStoredReaderTextWidthPreference } from '../utils/readerPreferences';
import type { CurrentUser, NewsArticle, NewsGroup, ReaderBlock, ReaderResponse, Translator } from '../types';

const sourceChipClassName = 'inline-flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1.5 text-xs font-medium text-sky-900';
const readTimeChipClassName = 'inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600';

function getArticleSourceLabel(article: NewsArticle | null) {
  if (!article) {
    return '';
  }

  const source = article.source || article.rawSource || '';
  const subSource = article.subSource && article.subSource !== source ? article.subSource : '';
  return source && subSource ? `${source} - ${subSource}` : (source || subSource);
}

function getSourceVersionItems(items: NewsArticle[] = []) {
  const articleItems = (Array.isArray(items) ? items : []).filter((item) => item?.id);
  const labelCounts = new Map<string, number>();
  const labelIndexes = new Map<string, number>();
  const getVersionLabel = (item: NewsArticle) => getArticleSourceLabel(item) || item.title || item.id || '';

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
      label: (labelCounts.get(label) || 0) > 1 ? `${label} #${index}` : label
    };
  });
}

function renderReaderBlock(block: ReaderBlock, index: number, readerTextStyles: Record<string, string>) {
  if (!block) {
    return null;
  }

  if (block.type === 'heading') {
    const TagName = `h${Math.min(Math.max(block.level || 2, 1), 6)}` as ElementType;
    const sizeClass = (block.level || 2) <= 2
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

function getReaderGroupKey(group: NewsGroup | null) {
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
}: {
  group: NewsGroup;
  initialArticleId?: string | null;
  readerPosition?: string;
  t: Translator;
  onClose: () => void;
  currentUser?: CurrentUser;
}) => {
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(initialArticleId || group?.items?.[0]?.id || null);
  const [readerByArticleId, setReaderByArticleId] = useState<Record<string, ReaderResponse>>({});
  const readerByArticleIdRef = useRef<Record<string, ReaderResponse>>({});
  const [loading, setLoading] = useState(false);
  const { shareState, shareArticle, resetShareState } = useShareArticle();
  const [readerTextSize, setReaderTextSize] = useState(() => getStoredReaderTextSizePreference(currentUser?.settings?.readerTextSize));
  const [readerTextWidth, setReaderTextWidth] = useState(() => getStoredReaderTextWidthPreference(currentUser?.settings?.readerTextWidth));
  const [error, setError] = useState<unknown>(null);
  const { startLatestRequest, resetLatestRequest } = useLatestRequest();
  const groupKey = useMemo(() => getReaderGroupKey(group), [group]);
  const previousGroupKeyRef = useRef(groupKey);
  const firstGroupArticleId = group?.items?.[0]?.id || null;
  const groupArticleIds = useMemo(() => {
    return new Set((Array.isArray(group?.items) ? group.items : []).map((item) => item?.id).filter((id): id is string => Boolean(id)));
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

  useEffect(() => {
    setReaderTextWidth(getStoredReaderTextWidthPreference(currentUser?.settings?.readerTextWidth));
  }, [currentUser?.settings?.readerTextWidth]);

  const selectedArticle = useMemo(() => {
    return group?.items?.find((item) => item.id === selectedArticleId) || group?.items?.[0] || null;
  }, [group?.items, selectedArticleId]);

  const sourceVersionItems = useMemo(() => {
    return getSourceVersionItems(group?.items || []);
  }, [group?.items]);

  const selectedReader = selectedArticleId ? readerByArticleId[selectedArticleId] : null;

  const loadReader = useCallback(async (articleId: string, { forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
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
  const readerTextWidthClassName = READER_TEXT_WIDTH_CLASS_NAMES[readerTextWidth] || READER_TEXT_WIDTH_CLASS_NAMES[DEFAULT_READER_TEXT_WIDTH];
  const handleShare = async () => {
    await shareArticle({
      url: safeOriginalUrl,
      title: selectedArticle?.title || ''
    });
  };

  const refreshReader = () => {
    if (!selectedArticleId || loading) {
      return;
    }

    loadReader(selectedArticleId, { forceRefresh: true });
  };

  const headerStart = (
    <h2 id="reader-panel-title" className="sr-only focus:outline-none" data-modal-title tabIndex={-1}>
      {t('readerMode')}: {selectedArticle?.title || t('readerMode')}
    </h2>
  );

  return (
    <FullscreenPanelFrame
      closeLabel={t('closeReader')}
      containerClassName={`relative flex h-full w-full ${desktopPositionClassName}`}
      headerActions={(
        <>
          <ReaderTextWidthControls currentUser={currentUser} onChange={setReaderTextWidth} t={t} value={readerTextWidth} />
          <ReaderTextSizeControls currentUser={currentUser} onChange={setReaderTextSize} t={t} value={readerTextSize} />
        </>
      )}
      headerStart={headerStart}
      labelledBy="reader-panel-title"
      onClose={onClose}
      panelClassName="flex h-full w-full flex-col overflow-hidden bg-white shadow-[0_20px_60px_-30px_rgba(15,23,42,0.35)] lg:m-4 lg:h-[calc(100dvh-2rem)] lg:w-[min(72rem,calc(100vw-2rem))] lg:rounded-[1.6rem] lg:border lg:border-slate-200"
    >
          <div className="min-h-0 flex-1 overflow-y-auto bg-white pb-[calc(1.5rem+env(safe-area-inset-bottom))] pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(1rem+env(safe-area-inset-right))] pt-6 sm:pl-[calc(1.25rem+env(safe-area-inset-left))] sm:pr-[calc(1.25rem+env(safe-area-inset-right))] md:pb-[calc(2rem+env(safe-area-inset-bottom))] md:pt-8 lg:pl-[calc(1.5rem+env(safe-area-inset-left))] lg:pr-[calc(1.5rem+env(safe-area-inset-right))]">
            {selectedArticle && (
              <div className={`mx-auto space-y-6 ${readerTextWidthClassName}`}>
                <div className="border-b border-slate-200 pb-6 md:pb-7">
                  <h2 className="text-pretty text-2xl font-semibold leading-tight tracking-tight text-stone-900 md:text-[2rem] md:leading-[1.15]">
                    {selectedArticle?.title || t('readerMode')}
                  </h2>

                  <div className="mt-4 flex items-start gap-3">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:gap-3">
                      {sourceVersionItems.length > 1 ? (
                        <label className={`${sourceChipClassName} min-w-0 max-w-full`}>
                          <Newspaper className="h-3.5 w-3.5 shrink-0" />
                          <span className="sr-only">{t('sourceVersions')}</span>
                          <select
                            value={selectedArticle?.id || ''}
                            onChange={(event) => setSelectedArticleId(event.target.value)}
                            className="min-w-0 max-w-[14rem] bg-transparent text-xs font-medium text-sky-900 outline-none"
                            aria-label={t('sourceVersions')}
                          >
                            {sourceVersionItems.map(({ item, label }) => (
                              <option key={item.id} value={item.id}>{label}</option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <span className={`${sourceChipClassName} min-w-0 max-w-full`}>
                          <Newspaper className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 truncate">{getArticleSourceLabel(selectedArticle)}</span>
                        </span>
                      )}
                      {selectedReader?.minutesToRead && (
                        <span className={`${readTimeChipClassName} shrink-0`}>
                          <Clock3 className="h-3.5 w-3.5" />
                          {t('readTime', { minutes: selectedReader.minutesToRead })}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
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
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label={t('shareArticle')}
                        >
                          <Share2 className="h-4 w-4" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={refreshReader}
                        disabled={!selectedArticleId || loading}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label={t('refreshReader')}
                        title={t('refreshReader')}
                      >
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  </div>
                </div>

                {loading && !selectedReader ? (
                  <div className="py-2">
                    <TextContentSkeleton label={t('loadingReader')} />
                  </div>
                ) : error && !selectedReader ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-8 text-center text-red-700">
                    <p className="inline-flex items-center gap-2 font-medium">
                      <AlertCircle className="h-4 w-4" />
                      {t('readerUnavailable')}
                    </p>
                  </div>
                ) : selectedReader ? (
                  <article className="pb-8">
                    {Boolean(error) && (
                      <div className="mb-8 inline-flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        {t('readerUnavailable')}
                      </div>
                    )}

                    {selectedReader.fallback && (
                      <div className="mb-8 inline-flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        {t('readerFallback')}
                      </div>
                    )}

                    {selectedReader.byline && (
                      <p className="mb-8 text-sm font-medium uppercase tracking-[0.16em] text-stone-400">{selectedReader.byline}</p>
                    )}

                    <div className="space-y-5">
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
