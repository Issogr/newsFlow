import React, { memo, useEffect, useRef, useState } from 'react';
import {
  BookOpenText,
  CalendarDays,
  ExternalLink,
  Share2,
} from 'lucide-react';
import { getDateLocale, getLocalizedTopic } from '../i18n';
import { getSafeExternalUrl } from '../utils/urlSafety';
import genericNewsCover from '../assets/generic-news-cover.webp';
import genericNewsCover2 from '../assets/generic-news-cover-2.webp';
import genericNewsCover3 from '../assets/generic-news-cover-3.webp';
import genericNewsCover4 from '../assets/generic-news-cover-4.webp';
import useShareArticle from '../hooks/useShareArticle';
import { getTopicPresentation } from '../topicPresentation';
import ShareStatusBubble from './ShareStatusBubble';

const GENERIC_NEWS_COVERS = [
  genericNewsCover,
  genericNewsCover2,
  genericNewsCover3,
  genericNewsCover4,
];

function getRandomGenericNewsCover() {
  return GENERIC_NEWS_COVERS[Math.floor(Math.random() * GENERIC_NEWS_COVERS.length)] || genericNewsCover;
}

function isGenericNewsCover(imageUrl) {
  return GENERIC_NEWS_COVERS.includes(imageUrl);
}

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

function getTopicEntries(group) {
  const topicMap = new Map();
  const addTopic = (entry) => {
    const topic = String(entry?.topic || entry || '').trim();
    if (!topic) {
      return;
    }

    const key = topic.toLowerCase();
    const current = topicMap.get(key);
    const nextEntry = {
      topic,
      source: String(entry?.source || current?.source || '').trim().toLowerCase()
    };

    if (!current || nextEntry.source === 'ai') {
      topicMap.set(key, nextEntry);
    }
  };

  (group?.topicDetails || []).forEach(addTopic);
  (group?.topics || []).forEach(addTopic);
  (group?.items || []).forEach((item) => {
    (item?.topicDetails || []).forEach(addTopic);
    (item?.topics || []).forEach(addTopic);
  });

  return [...topicMap.values()].slice(0, 4);
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
    const parsedDate = new Date(dateString);
    if (Number.isNaN(parsedDate.getTime())) {
      return '';
    }

    return parsedDate.toLocaleDateString(getDateLocale(locale), {
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
  const topicEntries = getTopicEntries(group);
  const safeOriginalUrl = getSafeExternalUrl(group?.url);
  const safeImageUrl = showImages ? getGroupImageUrl(group) : '';
  const [fallbackImageUrl, setFallbackImageUrl] = useState(getRandomGenericNewsCover);
  const [imageUrl, setImageUrl] = useState(showImages ? (safeImageUrl || fallbackImageUrl) : '');
  const { shareState, shareArticle } = useShareArticle();
  const fallbackImageAlt = t('genericNewsCoverAlt');
  const fallbackGroupIdRef = useRef(group?.id);
  const lastTouchGestureRef = useRef({ area: '', timestamp: 0 });
  const lastReaderOpenAtRef = useRef(0);

  useEffect(() => {
    if (fallbackGroupIdRef.current === group?.id) {
      return;
    }

    fallbackGroupIdRef.current = group?.id;
    setFallbackImageUrl(getRandomGenericNewsCover());
  }, [group?.id]);

  useEffect(() => {
    setImageUrl(showImages ? (safeImageUrl || fallbackImageUrl) : '');
  }, [fallbackImageUrl, safeImageUrl, showImages]);

  if (!hasItems) {
    return null;
  }

  const handleShare = async () => {
    await shareArticle({
      url: safeOriginalUrl,
      title: group.title
    });
  };

  const openReader = () => {
    const now = Date.now();
    if (lastReaderOpenAtRef.current && now >= lastReaderOpenAtRef.current && now - lastReaderOpenAtRef.current < 400) {
      return;
    }

    lastReaderOpenAtRef.current = now;
    onOpenReader(group, group.items[0]?.id);
  };

  const openOriginalSource = () => {
    if (!safeOriginalUrl) {
      return;
    }

    window.open(safeOriginalUrl, '_blank', 'noopener,noreferrer');
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

  const actionButtonClassName = `inline-flex min-w-0 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white font-medium text-slate-700 no-underline transition-colors hover:bg-slate-100 ${compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'}`;
  const disabledActionButtonClassName = `inline-flex min-w-0 cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-100 font-medium text-slate-400 ${compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'}`;
  const openOriginalSourceUnavailableMessage = t('openOriginalSourceUnavailable');

  const actionButtons = (
    <div className={`${compact ? '-mx-3 -mb-3 mt-auto border-t border-slate-100 bg-slate-50/70 px-3 py-2' : 'border-t border-slate-100 bg-slate-50/70 px-5 py-4'}`}>
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={openReader}
          className={actionButtonClassName}
          aria-label={t('readerMode')}
        >
          <BookOpenText className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} shrink-0`} />
          <span className="min-w-0 text-center leading-tight">{t('readerMode')}</span>
        </button>
        <button
          type="button"
          onClick={openOriginalSource}
          disabled={!safeOriginalUrl}
          className={safeOriginalUrl
            ? actionButtonClassName
            : disabledActionButtonClassName}
          aria-label={t('openOriginalSource')}
          aria-describedby={!safeOriginalUrl ? `open-original-source-help-${group?.id}` : undefined}
          title={!safeOriginalUrl ? openOriginalSourceUnavailableMessage : undefined}
        >
          <ExternalLink className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} shrink-0`} />
          <span className="min-w-0 text-center leading-tight">{t('openOriginalSource')}</span>
        </button>
      </div>
      {!safeOriginalUrl ? (
        <p
          id={`open-original-source-help-${group?.id}`}
          className={`${compact ? 'px-1 pt-2 text-[11px]' : 'pt-3 text-xs'} text-slate-500`}
        >
          {openOriginalSourceUnavailableMessage}
        </p>
      ) : null}
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
            alt={isGenericNewsCover(imageUrl) ? fallbackImageAlt : group.title}
            loading="lazy"
            className="h-full w-full object-cover"
            onDoubleClick={openReader}
            onError={() => {
              if (!showImages) {
                setImageUrl('');
                return;
              }

              setImageUrl((current) => (isGenericNewsCover(current) ? '' : fallbackImageUrl));
            }}
          />
          {!compact ? (
            <div className="absolute right-4 top-4 z-10 flex items-center justify-end">
              {shareControls}
            </div>
          ) : null}
          {!compact && sourceEntries.length > 0 ? (
            <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center gap-2 overflow-hidden px-4 py-3 bg-gradient-to-t from-black/60 to-transparent">
              {sourceEntries.map((source) => (
                <span
                  key={source.id}
                  className="inline-flex shrink-0 items-center gap-2 rounded-full bg-sky-100 px-3 py-1.5 text-xs font-medium text-sky-900"
                >
                  {source.name}
                </span>
              ))}
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

              {topicEntries.map(({ topic, source }) => {
                const { Icon, iconBadgeClassName } = getTopicPresentation(topic);
                const localizedTopic = getLocalizedTopic(topic, locale);
                const isAiTopic = source === 'ai';

                if (isAiTopic) {
                  return (
                    <span
                      key={topic}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full p-[1.5px] shadow-sm"
                      style={{ backgroundImage: 'conic-gradient(from 20deg, #f97316, #facc15, #22c55e, #06b6d4, #6366f1, #d946ef, #f97316)' }}
                      aria-label={localizedTopic}
                      title={localizedTopic}
                    >
                      <span className={`inline-flex h-full w-full items-center justify-center rounded-full ${iconBadgeClassName}`}>
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    </span>
                  );
                }

                return (
                  <span
                    key={topic}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full shadow-sm ${iconBadgeClassName}`}
                    aria-label={localizedTopic}
                    title={localizedTopic}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                );
              })}
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
