import React, { memo, useEffect, useRef, useState } from 'react';
import {
  BookOpenText,
  CalendarDays,
  ExternalLink,
  Rss,
  Share2,
} from 'lucide-react';
import { getDateLocale, getLocalizedTopic } from '../i18n';
import { getTopicPresentation } from '../topicPresentation';
import { getSafeExternalUrl } from '../utils/urlSafety';
import genericNewsCover from '../assets/generic-news-cover.webp';
import { shareArticleUrl } from '../utils/shareArticle';
import ShareStatusBubble from './ShareStatusBubble';

function getSourceEntries(group) {
  const sourceMap = new Map();

  (group?.items || []).forEach((item) => {
    if (!sourceMap.has(item.sourceId)) {
      sourceMap.set(item.sourceId, {
        id: item.sourceId,
        name: item.source
      });
    }
  });

  return [...sourceMap.values()];
}

function getGroupImageUrl(group) {
  const rawImageUrl = (group?.items || []).map((item) => item?.image).find(Boolean);
  return getSafeExternalUrl(rawImageUrl);
}

function formatPublicationDate(dateString, locale) {
  if (!dateString) {
    return '';
  }

  try {
    return new Date(dateString).toLocaleDateString(getDateLocale(locale), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

const NewsCard = memo(({ group, showImages = true, compact = false, locale, t, onOpenReader }) => {
  const hasItems = Boolean(group?.items?.length);

  const sourceEntries = getSourceEntries(group);
  const safeOriginalUrl = getSafeExternalUrl(group?.url);
  const safeImageUrl = showImages ? getGroupImageUrl(group) : '';
  const [imageUrl, setImageUrl] = useState(showImages ? (safeImageUrl || genericNewsCover) : '');
  const [shareState, setShareState] = useState('idle');
  const fallbackImageAlt = t('genericNewsCoverAlt');
  const lastTouchGestureRef = useRef({ area: '', timestamp: 0 });
  const lastReaderOpenAtRef = useRef(0);

  useEffect(() => {
    setImageUrl(showImages ? (safeImageUrl || genericNewsCover) : '');
  }, [safeImageUrl, showImages]);

  useEffect(() => {
    if (shareState === 'idle') {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setShareState('idle');
    }, 1600);

    return () => window.clearTimeout(timeoutId);
  }, [shareState]);

  if (!hasItems) {
    return null;
  }

  const handleShare = async () => {
    const result = await shareArticleUrl({
      url: safeOriginalUrl,
      title: group.title
    });

    setShareState(result || 'idle');
  };

  const openReader = () => {
    const now = Date.now();
    if (lastReaderOpenAtRef.current && now >= lastReaderOpenAtRef.current && now - lastReaderOpenAtRef.current < 400) {
      return;
    }

    lastReaderOpenAtRef.current = now;
    onOpenReader(group, group.items[0]?.id);
  };

  const handleReaderTouchEnd = (area) => {
    const now = Date.now();
    const lastTouchGesture = lastTouchGestureRef.current;

    if (lastTouchGesture.area === area && now - lastTouchGesture.timestamp < 320) {
      lastTouchGestureRef.current = { area: '', timestamp: 0 };
      openReader();
      return;
    }

    lastTouchGestureRef.current = { area, timestamp: now };
  };

  const interactionPropsByArea = {
    image: {
      onDoubleClick: openReader,
      onTouchEnd: () => handleReaderTouchEnd('image')
    },
    title: {
      onDoubleClick: openReader,
      onTouchEnd: () => handleReaderTouchEnd('title')
    }
  };

  const actionButtons = (
    <div className={`${compact ? '-mx-3 -mb-3 mt-auto border-t border-slate-100 bg-slate-50/70 px-3 py-2' : 'border-t border-slate-100 bg-slate-50/70 px-5 py-4'}`}>
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={openReader}
          className={`inline-flex min-w-0 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white font-medium text-slate-700 transition-colors hover:bg-slate-100 ${compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'}`}
          aria-label={t('readerMode')}
        >
          <BookOpenText className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
          <span>{t('readerMode')}</span>
        </button>
        {safeOriginalUrl ? (
          <a
            href={safeOriginalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex min-w-0 items-center justify-center rounded-xl border border-slate-900 bg-slate-900 font-medium text-white transition-colors hover:bg-slate-700 ${compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'}`}
          >
            <ExternalLink className={`${compact ? 'mr-1.5 h-3.5 w-3.5' : 'mr-2 h-4 w-4'}`} />
            {t('openOriginalSource')}
          </a>
        ) : (
          <button
            type="button"
            disabled
            className={`inline-flex min-w-0 cursor-not-allowed items-center justify-center rounded-xl bg-slate-300 font-medium text-slate-600 ${compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'}`}
          >
            <ExternalLink className={`${compact ? 'mr-1.5 h-3.5 w-3.5' : 'mr-2 h-4 w-4'}`} />
            {t('openOriginalSource')}
          </button>
        )}
      </div>
    </div>
  );

  const compactWithoutImage = compact && !imageUrl;
  const shareControls = (
    <>
      <ShareStatusBubble
        shareState={shareState}
        t={t}
        className={`share-status-pill-from-button ${compact ? 'order-2 ml-2 max-w-[min(12rem,calc(100vw-9rem))]' : 'mr-2 max-w-[min(16rem,calc(100vw-7rem))]'}`}
      />
      <button
        type="button"
        onClick={handleShare}
        disabled={!safeOriginalUrl}
        className={`inline-flex shrink-0 items-center justify-center rounded-full border bg-white/80 text-slate-700 shadow-sm backdrop-blur-md transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 ${compact ? 'order-1 h-10 w-10 border-slate-200/80' : 'h-11 w-11 border-white/60'}`}
        aria-label={t('shareArticle')}
      >
        <Share2 className="h-4 w-4" />
      </button>
    </>
  );

  return (
    <article className={`relative flex overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-xl ${compact ? 'h-[12.5rem] max-h-[12.5rem] flex-row' : 'h-full min-h-[20rem] flex-col'}`}>
      {compact && !compactWithoutImage ? (
        <div className="absolute z-10 flex items-center left-3 top-3 justify-start">
          {shareControls}
        </div>
      ) : null}

      {imageUrl ? (
        <div
          className={compact ? 'w-[34%] min-w-[7.75rem] max-w-[10rem] overflow-hidden bg-slate-100' : 'relative aspect-[16/9] w-full overflow-hidden bg-slate-100'}
          {...interactionPropsByArea.image}
        >
          <img
            src={imageUrl}
            alt={imageUrl === genericNewsCover ? fallbackImageAlt : group.title}
            loading="lazy"
            className="h-full w-full object-cover"
            onDoubleClick={openReader}
            onError={() => {
              if (!showImages) {
                setImageUrl('');
                return;
              }

              setImageUrl((current) => (current === genericNewsCover ? '' : genericNewsCover));
            }}
          />
          {!compact ? (
            <div className="absolute right-4 top-4 z-10 flex items-center justify-end">
              {shareControls}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={`flex min-w-0 flex-1 flex-col ${compact ? 'p-3' : 'p-5'}`}>
        {compactWithoutImage ? (
          <div className="flex items-start gap-2">
            <div className="flex shrink-0 items-center justify-start">
              {shareControls}
            </div>
            <h2
              className="min-w-0 flex-1 pt-1 text-[15px] font-semibold leading-5 text-slate-900"
              {...interactionPropsByArea.title}
            >
              {group.title}
            </h2>
          </div>
        ) : (
          <>
            {!compact && !imageUrl ? (
              <div className="flex justify-end mb-2">
                {shareControls}
              </div>
            ) : null}
            <h2
              className={`${compact ? 'pr-1 text-[15px] leading-5' : 'text-xl'} font-semibold text-slate-900`}
              {...interactionPropsByArea.title}
            >
              {group.title}
            </h2>
          </>
        )}

        {compact ? null : (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />
                {formatPublicationDate(group.pubDate, locale)}
              </span>

              {group.topics?.map((topic) => {
                const { Icon, className } = getTopicPresentation(topic);
                const localizedTopic = getLocalizedTopic(topic, locale);

                return (
                  <span
                    key={topic}
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${className}`}
                    aria-label={localizedTopic}
                    title={localizedTopic}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                );
              })}
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
                <Rss className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('sources')}</span>
              </div>
              <div className="flex min-h-7 flex-wrap content-start gap-2">
                {sourceEntries.map((source) => (
                  <span
                    key={source.id}
                    className="inline-flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1.5 text-xs font-medium text-sky-900"
                  >
                    {source.name}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        {compact ? actionButtons : null}
      </div>
      {compact ? null : actionButtons}
    </article>
  );
});

NewsCard.displayName = 'NewsCard';

export default NewsCard;
