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
import SourceIcon from './SourceIcon';

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
        name: item.source,
        iconUrl: item.sourceIconUrl || ''
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

const NewsCard = memo(({ group, showImages = true, locale, t, onOpenReader }) => {
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

  const readerActionButtonClassName = 'inline-flex min-w-0 items-center justify-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-800 no-underline shadow-sm transition-colors hover:bg-indigo-100';
  const originalActionButtonClassName = 'inline-flex min-w-0 items-center justify-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 no-underline shadow-sm transition-colors hover:bg-emerald-100';
  const disabledActionButtonClassName = 'inline-flex min-w-0 cursor-not-allowed items-center justify-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-400';
  const openOriginalSourceUnavailableMessage = t('openOriginalSourceUnavailable');
  const publicationDate = formatPublicationDate(group.pubDate, locale);

  const actionButtons = (
    <div className="mt-auto px-4 pb-4 sm:px-5">
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={openReader}
          className={readerActionButtonClassName}
          aria-label={t('readerMode')}
        >
          <BookOpenText className="h-4 w-4 shrink-0" />
          <span className="min-w-0 text-center leading-tight">{t('readerMode')}</span>
        </button>
        <button
          type="button"
          onClick={openOriginalSource}
          disabled={!safeOriginalUrl}
          className={safeOriginalUrl
            ? originalActionButtonClassName
            : disabledActionButtonClassName}
          aria-label={t('openOriginalSource')}
          aria-describedby={!safeOriginalUrl ? `open-original-source-help-${group?.id}` : undefined}
          title={!safeOriginalUrl ? openOriginalSourceUnavailableMessage : undefined}
        >
          <ExternalLink className="h-4 w-4 shrink-0" />
          <span className="min-w-0 text-center leading-tight">{t('openOriginalSource')}</span>
        </button>
      </div>
      {!safeOriginalUrl ? (
        <p
          id={`open-original-source-help-${group?.id}`}
          className="px-1 pt-2 text-xs text-slate-500"
        >
          {openOriginalSourceUnavailableMessage}
        </p>
      ) : null}
    </div>
  );

  const sourceIconStack = sourceEntries.length > 0 ? (
    <div className="flex -space-x-2 rounded-full bg-sky-50/90 p-1 shadow-sm ring-1 ring-sky-100" aria-label={t('sources')}>
      {sourceEntries.slice(0, 3).map((source) => (
        <span key={source.id} title={source.name} aria-label={source.name}>
          <SourceIcon
            source={source}
            className="h-10 w-10 border-2 border-white bg-white shadow-md"
            imageClassName="h-5 w-5"
          />
        </span>
      ))}
      {sourceEntries.length > 3 ? (
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border-2 border-white bg-sky-100 text-xs font-bold text-sky-800 shadow-md">
          +{sourceEntries.length - 3}
        </span>
      ) : null}
    </div>
  ) : null;
  const sourceSummary = sourceEntries.length > 0
    ? `${sourceEntries[0].name}${sourceEntries.length > 1 ? ` +${sourceEntries.length - 1}` : ''}`
    : '';
  const shareControls = (
    <div className="relative flex items-center justify-end">
      <ShareStatusBubble
        shareState={shareState}
        t={t}
        className="share-status-pill-from-button mr-2 max-w-[min(16rem,calc(100vw-7rem))]"
      />
      <button
        type="button"
        onClick={handleShare}
        disabled={!safeOriginalUrl}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-sky-800 shadow-md transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
        aria-label={t('shareArticle')}
      >
        <Share2 className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <article className="relative flex h-full min-h-[18rem] flex-col overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-xl">
      <div className="flex min-w-0 items-center gap-3 px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
        {sourceIconStack}
        <div className="min-w-0 flex-1">
          {sourceSummary ? (
            <p className="truncate text-sm font-semibold text-slate-950">{sourceSummary}</p>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
            {publicationDate ? (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />
                {publicationDate}
              </span>
            ) : null}
            {topicEntries.map(({ topic, source }) => {
              const { Icon, iconBadgeClassName } = getTopicPresentation(topic);
              const localizedTopic = getLocalizedTopic(topic, locale);
              const isAiTopic = source === 'ai';

              if (isAiTopic) {
                return (
                  <span
                    key={topic}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full p-[1.5px] shadow-sm"
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
        </div>
        {shareControls}
      </div>

      {imageUrl ? (
        <div
          className="relative mx-4 aspect-[16/9] overflow-hidden rounded-3xl bg-slate-100 sm:mx-5"
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
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col px-4 pb-4 pt-3 sm:px-5">
        <h2
          className="text-lg font-semibold leading-6 text-slate-900 sm:text-xl"
          {...interactionPropsByArea.title}
        >
          {group.title}
        </h2>
      </div>
      {actionButtons}
    </article>
  );
});

NewsCard.displayName = 'NewsCard';

export default NewsCard;
