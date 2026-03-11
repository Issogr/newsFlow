import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BookOpenText,
  CalendarDays,
  Clock3,
  ExternalLink,
  Languages,
  Newspaper,
  RefreshCw,
  X
} from 'lucide-react';
import { fetchReaderArticle, isRequestCanceled } from '../services/api';
import useLatestRequest from '../hooks/useLatestRequest';
import { getDateLocale, getLanguageMeta } from '../i18n';

const blockClassName = {
  paragraph: 'text-[1.08rem] leading-8 text-stone-800',
  blockquote: 'border-l-4 border-stone-300 bg-stone-50/80 pl-5 pr-2 italic text-stone-700',
  preformatted: 'overflow-x-auto rounded-2xl bg-stone-900 px-4 py-4 text-sm leading-7 text-stone-100'
};

const metaChipClassName = 'inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1.5 shadow-sm';

function getArticleSourceLabel(article) {
  if (!article) {
    return '';
  }

  return article.source || article.rawSource || '';
}

function renderReaderBlock(block, index) {
  if (!block) {
    return null;
  }

  if (block.type === 'heading') {
    const TagName = `h${Math.min(Math.max(block.level || 2, 1), 6)}`;
    const sizeClass = block.level <= 2 ? 'text-2xl md:text-3xl' : block.level === 3 ? 'text-xl md:text-2xl' : 'text-lg';
    return <TagName key={`${block.type}-${index}`} className={`font-semibold leading-tight tracking-tight text-stone-900 ${sizeClass}`}>{block.text}</TagName>;
  }

  if (block.type === 'unordered-list' || block.type === 'ordered-list') {
    const ListTag = block.type === 'ordered-list' ? 'ol' : 'ul';
    return (
      <ListTag
        key={`${block.type}-${index}`}
        className={`space-y-3 pl-6 text-[1.04rem] leading-8 text-stone-800 ${block.type === 'ordered-list' ? 'list-decimal' : 'list-disc'}`}
      >
        {block.items.map((item, itemIndex) => (
          <li key={`${block.type}-${index}-${itemIndex}`}>{item}</li>
        ))}
      </ListTag>
    );
  }

  if (block.type === 'preformatted') {
    return <pre key={`${block.type}-${index}`} className={blockClassName.preformatted}>{block.text}</pre>;
  }

  if (block.type === 'blockquote') {
    return <blockquote key={`${block.type}-${index}`} className={blockClassName.blockquote}>{block.text}</blockquote>;
  }

  return <p key={`${block.type}-${index}`} className={blockClassName.paragraph}>{block.text}</p>;
}

const ReaderPanel = ({ group, initialArticleId, readerPosition = 'right', locale, t, onClose }) => {
  const dateLocale = getDateLocale(locale);
  const [selectedArticleId, setSelectedArticleId] = useState(initialArticleId || group?.items?.[0]?.id || null);
  const [readerByArticleId, setReaderByArticleId] = useState({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const readerCacheRef = useRef({});
  const { startLatestRequest, resetLatestRequest } = useLatestRequest();

  useEffect(() => {
    readerCacheRef.current = readerByArticleId;
  }, [readerByArticleId]);

  useEffect(() => {
    setSelectedArticleId(initialArticleId || group?.items?.[0]?.id || null);
    setReaderByArticleId({});
    setError(null);
    readerCacheRef.current = {};
    resetLatestRequest();
  }, [group, initialArticleId, resetLatestRequest]);

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const selectedArticle = useMemo(() => {
    return group?.items?.find((item) => item.id === selectedArticleId) || group?.items?.[0] || null;
  }, [group?.items, selectedArticleId]);

  const sourceVersionItems = useMemo(() => {
    const groupedItems = new Map();

    (group?.items || []).forEach((item) => {
      if (!groupedItems.has(item.sourceId)) {
        groupedItems.set(item.sourceId, item);
      }
    });

    return [...groupedItems.values()];
  }, [group?.items]);

  const selectedReader = selectedArticleId ? readerByArticleId[selectedArticleId] : null;

  const loadReader = useCallback(async (articleId, refresh = false) => {
    if (!articleId) {
      return;
    }

    if (!refresh && readerCacheRef.current[articleId]) {
      return;
    }

    const request = startLatestRequest();

    setError(null);
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const payload = await fetchReaderArticle(articleId, { refresh, signal: request.signal });

      if (!request.isLatest()) {
        return;
      }

      setReaderByArticleId((current) => ({
        ...current,
        [articleId]: payload
      }));
    } catch (requestError) {
      if (!isRequestCanceled(requestError) && request.isLatest()) {
        setError(requestError);
      }
    } finally {
      if (request.isLatest()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [startLatestRequest]);

  useEffect(() => {
    if (selectedArticleId) {
      loadReader(selectedArticleId);
    }
  }, [loadReader, selectedArticleId]);

  const formatDate = (dateString) => {
    if (!dateString) {
      return '';
    }

    return new Date(dateString).toLocaleString(dateLocale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const languageMeta = getLanguageMeta(selectedReader?.language || selectedArticle?.language, locale);
  const desktopPositionClassName = readerPosition === 'left'
    ? 'lg:justify-start'
    : (readerPosition === 'center' ? 'lg:justify-center' : 'lg:justify-end');

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-sm">
      <button
        type="button"
        className="absolute inset-0 hidden cursor-default lg:block"
        aria-label={t('closeReader')}
        onClick={onClose}
      />

      <div className={`relative flex h-full w-full ${desktopPositionClassName}`}>
        <section className="flex h-full w-full flex-col bg-stone-50 shadow-2xl lg:max-w-4xl">
          <div className="flex items-center justify-between border-b border-stone-200 bg-white px-5 py-4">
            <div>
              <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">
                <BookOpenText className="h-4 w-4" />
                {t('cleanReadingView')}
              </p>
              <h2 className="mt-2 max-w-2xl text-xl font-semibold leading-tight text-stone-900 md:text-2xl">
                {selectedReader?.title || selectedArticle?.title || t('readerMode')}
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-2 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800"
                aria-label={t('closeReader')}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {sourceVersionItems.length > 1 && (
            <div className="border-b border-stone-200 bg-white px-5 py-3">
              <p className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
                <Newspaper className="h-4 w-4" />
                {t('sourceVersions')}
              </p>
              <div className="flex flex-wrap gap-2">
                {sourceVersionItems.map((item) => {
                  const isActive = item.sourceId === selectedArticle?.sourceId;
                  return (
                    <button
                      key={item.sourceId}
                      type="button"
                      onClick={() => setSelectedArticleId(item.id)}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                        isActive ? 'bg-slate-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                      }`}
                    >
                      {getArticleSourceLabel(item)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-5 py-6 md:px-8">
            {selectedArticle && (
              <div className="mx-auto max-w-[46rem]">
                <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-stone-500">
                  <span className={metaChipClassName}>
                    <Newspaper className="h-4 w-4 text-stone-400" />
                    {getArticleSourceLabel(selectedArticle)}
                  </span>
                  <span className={metaChipClassName}>
                    <CalendarDays className="h-4 w-4 text-stone-400" />
                    {formatDate(selectedArticle.pubDate)}
                  </span>
                  <span
                    className={metaChipClassName}
                    title={t('newsLanguage', { language: languageMeta.label })}
                  >
                    <Languages className="h-4 w-4 text-stone-400" />
                    {languageMeta.emoji}
                  </span>
                  {selectedReader?.minutesToRead && (
                    <span className={metaChipClassName}>
                      <Clock3 className="h-4 w-4 text-stone-400" />
                      {t('readTime', { minutes: selectedReader.minutesToRead })}
                    </span>
                  )}
                </div>

                <div className="mb-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => loadReader(selectedArticleId, true)}
                    disabled={refreshing || !selectedArticleId}
                    className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                    {t('refreshReader')}
                  </button>
                  <a
                    href={selectedArticle.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {t('openOriginalSource')}
                  </a>
                </div>

                {loading && !selectedReader ? (
                  <div className="rounded-3xl border border-stone-200 bg-white px-6 py-10 text-center shadow-sm">
                    <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-stone-200 border-t-slate-900" />
                    <p className="mt-4 inline-flex items-center gap-2 text-sm text-stone-500">
                      <BookOpenText className="h-4 w-4" />
                      {t('loadingReader')}
                    </p>
                  </div>
                ) : error ? (
                  <div className="rounded-3xl border border-red-200 bg-red-50 px-6 py-8 text-center text-red-700 shadow-sm">
                    <p className="inline-flex items-center gap-2 font-medium">
                      <AlertCircle className="h-4 w-4" />
                      {t('readerUnavailable')}
                    </p>
                  </div>
                ) : selectedReader ? (
                  <article className="rounded-[2rem] border border-stone-200 bg-white px-6 py-8 shadow-sm md:px-10">
                    {selectedReader.excerpt && (
                      <p className="mb-7 border-l-4 border-stone-200 pl-4 text-lg leading-8 text-stone-600 md:text-[1.18rem]">
                        {selectedReader.excerpt}
                      </p>
                    )}

                    {selectedReader.fallback && (
                      <div className="mb-6 inline-flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        {t('readerFallback')}
                      </div>
                    )}

                    {selectedReader.byline && (
                      <p className="mb-6 text-sm font-medium uppercase tracking-[0.16em] text-stone-400">{selectedReader.byline}</p>
                    )}

                    <div className="space-y-6 tracking-[0.01em]">
                      {(selectedReader.contentBlocks || []).map((block, index) => renderReaderBlock(block, index))}
                    </div>
                  </article>
                ) : null}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default ReaderPanel;
