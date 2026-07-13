import { memo, useEffect, useRef, useState } from 'react';
import {
  BookOpenText,
  Bookmark,
  BookmarkCheck,
  Clock3,
  ExternalLink,
  Share2,
} from 'lucide-react';
import { getLocalizedTopic } from '../i18n';
import { getSafeExternalUrl } from '../utils/urlSafety';
import { addTopicEntry } from '../utils/topicEntries';
import genericNewsCover from '../assets/generic-news-cover.webp';
import genericNewsCover2 from '../assets/generic-news-cover-2.webp';
import genericNewsCover3 from '../assets/generic-news-cover-3.webp';
import genericNewsCover4 from '../assets/generic-news-cover-4.webp';
import useShareArticle from '../hooks/useShareArticle';
import { AI_ACCENT_GRADIENT_STYLE, getTopicPresentation } from '../topicPresentation';
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

function isGifImageUrl(imageUrl) {
  try {
    return new URL(String(imageUrl || '')).pathname.toLowerCase().endsWith('.gif');
  } catch {
    return false;
  }
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

function getGroupItemCount(group) {
  const itemIds = new Set();

  (group?.items || []).forEach((item) => {
    const key = item?.id || item?.url || item?.title;
    if (key) {
      itemIds.add(key);
    }
  });

  return itemIds.size;
}

function getSourceSummary(group, sourceEntries) {
  if (!Array.isArray(sourceEntries) || sourceEntries.length === 0) {
    return '';
  }

  const visibleCount = sourceEntries.length > 1 ? sourceEntries.length : Math.max(sourceEntries.length, getGroupItemCount(group));
  return `${sourceEntries[0].name}${visibleCount > 1 ? ` +${visibleCount - 1}` : ''}`;
}

function getTopicEntries(group) {
  const topicMap = new Map();
  const addTopic = (entry) => addTopicEntry(topicMap, entry);

  (group?.topicDetails || []).forEach(addTopic);
  (group?.topics || []).forEach(addTopic);
  (group?.items || []).forEach((item) => {
    (item?.topicDetails || []).forEach(addTopic);
    (item?.topics || []).forEach(addTopic);
  });

  return [...topicMap.values()].slice(0, 4);
}

function getGroupImageUrl(group) {
  for (const item of group?.items || []) {
    const safeImageUrl = getSafeExternalUrl(item?.image);
    if (safeImageUrl && !isGifImageUrl(safeImageUrl)) {
      return safeImageUrl;
    }
  }

  return '';
}

function isAiGroupedStory(group) {
  if (getGroupItemCount(group) <= 1) {
    return false;
  }

  return (group?.items || []).some((item) => {
    return item?.storyGroupId && String(item?.aiStoryGroupStatus || '').toLowerCase() === 'matched';
  });
}

function getPublishedAt(group, locale) {
  const rawDate = group?.pubDate || group?.items?.[0]?.pubDate || '';
  if (!rawDate) {
    return null;
  }

  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return {
    iso: date.toISOString(),
    label: new Intl.DateTimeFormat(locale || 'en', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date)
  };
}

const CLICKBAIT_BADGE_CLASS_NAMES = {
  low: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-800',
  high: 'border-rose-200 bg-rose-50 text-rose-700'
};

function normalizeClickbaitLabel(label = '') {
  const normalized = String(label || '').trim().toLowerCase();
  return ['low', 'medium', 'high'].includes(normalized) ? normalized : '';
}

function getClickbaitLabelText(label, t) {
  const labels = {
    low: t('clickbaitLow'),
    medium: t('clickbaitMedium'),
    high: t('clickbaitHigh')
  };

  return labels[label] || '';
}

const NewsCard = memo(({ group, showImages = true, locale, t, onOpenReader, onToggleReadLater, readLaterUpdating = false }) => {
  const hasItems = Boolean(group?.items?.length);

  const sourceEntries = getSourceEntries(group);
  const topicEntries = getTopicEntries(group);
  const safeOriginalUrl = getSafeExternalUrl(group?.url);
  const safeImageUrl = showImages ? getGroupImageUrl(group) : '';
  const aiGroupedStory = isAiGroupedStory(group);
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

  const readerActionButtonClassName = 'inline-flex min-w-0 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white no-underline shadow-sm transition-all hover:-translate-y-0.5 hover:bg-violet-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 active:translate-y-0';
  const originalActionButtonClassName = 'inline-flex min-w-0 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white no-underline shadow-sm transition-all hover:-translate-y-0.5 hover:bg-emerald-600 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 active:translate-y-0';
  const disabledActionButtonClassName = 'inline-flex min-w-0 cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-400';
  const openOriginalSourceUnavailableMessage = t('openOriginalSourceUnavailable');

  const actionButtons = (
    <div className="mt-auto border-t border-slate-100 bg-slate-50/60 px-4 py-3.5 sm:px-5">
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={openReader}
          className={readerActionButtonClassName}
          aria-label={t('readHere')}
          title={t('readHereHelp')}
        >
          <BookOpenText className="h-4 w-4 shrink-0" />
          <span className="min-w-0 text-center leading-tight sm:hidden">{t('readHereShort')}</span>
          <span className="hidden min-w-0 text-center leading-tight sm:inline">{t('readHere')}</span>
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
          title={safeOriginalUrl ? t('openOriginalSourceHelp') : openOriginalSourceUnavailableMessage}
        >
          <ExternalLink className="h-4 w-4 shrink-0" />
          <span className="min-w-0 text-center leading-tight sm:hidden">{t('openOriginalSourceShort')}</span>
          <span className="hidden min-w-0 text-center leading-tight sm:inline">{t('openOriginalSource')}</span>
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

  const sourceIconItems = sourceEntries.slice(0, 2).map((source) => (
    <span key={source.id} title={source.name} aria-label={source.name}>
      <SourceIcon
        source={source}
        className="h-10 w-10 border-2 border-white bg-white shadow-md"
        imageClassName="h-5 w-5"
      />
    </span>
  ));
  const sourceIconStack = sourceEntries.length > 0 ? (aiGroupedStory ? (
    <div
      className="inline-flex rounded-full p-0.5 shadow-sm"
      style={AI_ACCENT_GRADIENT_STYLE}
      aria-label={t('aiGroupedStory')}
      title={t('aiGroupedStory')}
    >
      <div className="flex -space-x-2 rounded-full bg-white p-1">
        {sourceIconItems}
      </div>
    </div>
  ) : (
    <div className="flex -space-x-2 rounded-full bg-white p-1 shadow-sm ring-1 ring-sky-200" aria-label={t('sources')}>
      {sourceIconItems}
    </div>
  )) : null;
  const sourceSummary = getSourceSummary(group, sourceEntries);
  const publishedAt = getPublishedAt(group, locale);
  const clickbaitLabel = normalizeClickbaitLabel(group?.clickbaitLabel || group?.items?.[0]?.clickbaitLabel);
  const clickbaitText = getClickbaitLabelText(clickbaitLabel, t);
  const clickbaitSource = String(group?.clickbaitSource || group?.items?.[0]?.clickbaitSource || '').toLowerCase();
  const clickbaitBadge = clickbaitText ? (
    <span
      className={clickbaitSource === 'ai' ? 'inline-flex rounded-full p-[1.5px] shadow-sm' : ''}
      style={clickbaitSource === 'ai' ? AI_ACCENT_GRADIENT_STYLE : undefined}
      title={clickbaitSource === 'ai' ? t('aiClickbaitLabel') : clickbaitText}
    >
      <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-semibold shadow-sm ${CLICKBAIT_BADGE_CLASS_NAMES[clickbaitLabel]}`}>
        {clickbaitText}
      </span>
    </span>
  ) : null;
  const topicBadges = topicEntries.length > 0 ? (
    <div className="flex w-fit -space-x-1 rounded-full bg-white/85 p-1.5 text-xs font-medium text-slate-600 shadow-lg ring-1 ring-white/70 backdrop-blur-md">
      {topicEntries.map(({ topic, source }) => {
        const { Icon, iconBadgeClassName } = getTopicPresentation(topic);
        const localizedTopic = getLocalizedTopic(topic, locale);
        const isAiTopic = source === 'ai';

        if (isAiTopic) {
          return (
            <span
              key={topic}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full p-[1.5px] shadow-sm ring-2 ring-white"
              style={AI_ACCENT_GRADIENT_STYLE}
              aria-label={localizedTopic}
              title={localizedTopic}
            >
              <span className={`inline-flex h-full w-full items-center justify-center rounded-full ${iconBadgeClassName}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
            </span>
          );
        }

        return (
          <span
            key={topic}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full shadow-sm ring-2 ring-white ${iconBadgeClassName}`}
            aria-label={localizedTopic}
            title={localizedTopic}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        );
      })}
    </div>
  ) : null;
  const shareControls = (
    <div className="relative ml-auto flex items-center justify-end gap-2">
      <ShareStatusBubble
        shareState={shareState}
        t={t}
        className="share-status-pill-from-button z-20 mr-0 max-w-[min(16rem,calc(100vw-8rem))]"
      />
      <button
        type="button"
        onClick={() => onToggleReadLater?.(group)}
        disabled={readLaterUpdating}
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 active:translate-y-0 disabled:cursor-wait disabled:opacity-70 ${group.readLater ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100' : 'border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100'}`}
        aria-label={group.readLater ? t('removeReadLater') : t('saveReadLater')}
        aria-pressed={Boolean(group.readLater)}
        title={group.readLater ? t('removeReadLater') : t('saveReadLater')}
      >
        {group.readLater ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={handleShare}
        disabled={!safeOriginalUrl}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-sky-800 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-sky-100 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 active:translate-y-0 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
        aria-label={t('shareArticle')}
      >
        <Share2 className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <article className="group relative flex h-full min-h-[20rem] w-full min-w-0 flex-col overflow-hidden rounded-none border-y border-slate-200 bg-white shadow-[0_12px_34px_-20px_rgba(15,23,42,0.45)] transition-all duration-200 ease-out hover:-translate-y-1 hover:border-sky-200 hover:shadow-[0_24px_48px_-24px_rgba(14,165,233,0.5)] focus-within:ring-2 focus-within:ring-sky-300 sm:rounded-[1.75rem] sm:border">
      <div className="flex min-w-0 items-center gap-3 px-4 pb-3 pt-5 sm:px-5">
        {sourceIconStack}
        <div className="min-w-0 flex-1">
          {sourceSummary ? (
            <p className="truncate text-sm font-bold text-slate-950">{sourceSummary}</p>
          ) : null}
          {publishedAt ? (
            <time
              dateTime={publishedAt.iso}
              aria-label={t('publishedAt', { date: publishedAt.label })}
              className="mt-1 inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-slate-500"
            >
              <Clock3 className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-hidden="true" />
              <span className="truncate">{publishedAt.label}</span>
            </time>
          ) : null}
        </div>
        {shareControls}
      </div>

      {imageUrl ? (
        <div
          className="relative aspect-video w-full overflow-hidden border-y border-slate-100 bg-slate-100"
          {...interactionPropsByArea.image}
        >
          <img
            src={imageUrl}
            alt={isGenericNewsCover(imageUrl) ? fallbackImageAlt : group.title}
            loading="lazy"
            className="block h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.015]"
            onError={() => {
              if (!showImages) {
                setImageUrl('');
                return;
              }

              setImageUrl((current) => (isGenericNewsCover(current) ? '' : fallbackImageUrl));
            }}
          />
          {topicBadges ? (
            <div className="absolute bottom-3 left-3 z-10">
              {topicBadges}
            </div>
          ) : null}
        </div>
      ) : null}

      {!imageUrl && topicBadges ? (
        <div className="px-4 pt-3 sm:px-5">
          {topicBadges}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col px-4 pb-4 pt-3 sm:px-5">
        <h2
          className="text-lg font-bold leading-6 tracking-[-0.01em] text-slate-900 sm:text-xl"
          {...interactionPropsByArea.title}
        >
          {group.title}
        </h2>
        {clickbaitBadge ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {clickbaitBadge}
          </div>
        ) : null}
      </div>
      {actionButtons}
    </article>
  );
});

NewsCard.displayName = 'NewsCard';

export default NewsCard;
