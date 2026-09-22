import { memo, useEffect, useRef, useState, type TouchEvent } from 'react';
import {
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
import type { Locale, NewsGroup, NewsSource, TopicEntry, Translator } from '../types';

const GENERIC_NEWS_COVERS = [
  genericNewsCover,
  genericNewsCover2,
  genericNewsCover3,
  genericNewsCover4,
];
const READER_TOUCH_MOVE_TOLERANCE = 8;
const READER_CLICK_SUPPRESSION_MS = 500;

function getRandomGenericNewsCover() {
  return GENERIC_NEWS_COVERS[Math.floor(Math.random() * GENERIC_NEWS_COVERS.length)] || genericNewsCover;
}

function isGenericNewsCover(imageUrl: string) {
  return GENERIC_NEWS_COVERS.includes(imageUrl);
}

function isGifImageUrl(imageUrl: string) {
  try {
    return new URL(String(imageUrl || '')).pathname.toLowerCase().endsWith('.gif');
  } catch {
    return false;
  }
}

type SourceEntry = Partial<NewsSource> & Pick<NewsSource, 'name'>;

function getSourceEntries(group: NewsGroup) {
  const sourceMap = new Map<string, SourceEntry>();

  (group?.items || []).forEach((item) => {
    const sourceKey = item.sourceId || item.source || '';
    if (!sourceMap.has(sourceKey)) {
      sourceMap.set(sourceKey, {
        id: item.sourceId,
        name: item.source || '',
        iconUrl: item.sourceIconUrl || ''
      });
    }
  });

  return [...sourceMap.values()];
}

function getGroupItemCount(group: NewsGroup) {
  const itemIds = new Set<string>();

  (group?.items || []).forEach((item) => {
    const key = item?.id || item?.url || item?.title;
    if (key) {
      itemIds.add(key);
    }
  });

  return itemIds.size;
}

function getSourceSummary(group: NewsGroup, sourceEntries: SourceEntry[]) {
  if (sourceEntries.length === 0) {
    return '';
  }

  const visibleCount = sourceEntries.length > 1 ? sourceEntries.length : Math.max(sourceEntries.length, getGroupItemCount(group));
  return `${sourceEntries[0].name}${visibleCount > 1 ? ` +${visibleCount - 1}` : ''}`;
}

function getTopicEntries(group: NewsGroup) {
  const topicMap = new Map<string, TopicEntry>();
  const addTopic = (entry: TopicEntry | string) => addTopicEntry(topicMap, entry);

  (group?.topicDetails || []).forEach(addTopic);
  (group?.topics || []).forEach(addTopic);
  (group?.items || []).forEach((item) => {
    (item?.topicDetails || []).forEach(addTopic);
    (item?.topics || []).forEach(addTopic);
  });

  return [...topicMap.values()].slice(0, 4);
}

function getGroupImageUrl(group: NewsGroup) {
  for (const item of group?.items || []) {
    const safeImageUrl = getSafeExternalUrl(item?.image);
    if (safeImageUrl && !isGifImageUrl(safeImageUrl)) {
      return safeImageUrl;
    }
  }

  return '';
}

function isAiGroupedStory(group: NewsGroup) {
  if (getGroupItemCount(group) <= 1) {
    return false;
  }

  return (group?.items || []).some((item) => {
    return item?.storyGroupId && String(item?.aiStoryGroupStatus || '').toLowerCase() === 'matched';
  });
}

function getPublishedAt(group: NewsGroup, locale: Locale) {
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

const NewsCard = memo(({ group, showImages = true, locale, t, onOpenReader, onToggleReadLater, readLaterUpdating = false }: {
  group: NewsGroup;
  showImages?: boolean;
  locale: Locale;
  t: Translator;
  onOpenReader: (group: NewsGroup, articleId?: string) => void;
  onToggleReadLater?: (group: NewsGroup) => void | Promise<void>;
  readLaterUpdating?: boolean;
}) => {
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
  const readerTouchStartRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const suppressReaderClickUntilRef = useRef(0);
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

  const handleReaderClick = () => {
    if (Date.now() < suppressReaderClickUntilRef.current) {
      return;
    }

    openReader();
  };

  const handleReaderTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      readerTouchStartRef.current = null;
      return;
    }

    const touch = event.touches[0];
    readerTouchStartRef.current = { x: touch.clientX, y: touch.clientY, moved: false };
  };

  const handleReaderTouchMove = (event: TouchEvent) => {
    const touchStart = readerTouchStartRef.current;
    if (!touchStart) {
      return;
    }

    if (event.touches.length !== 1) {
      touchStart.moved = true;
      return;
    }

    const touch = event.touches[0];
    touchStart.moved ||= Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y) > READER_TOUCH_MOVE_TOLERANCE;
  };

  const handleReaderTouchEnd = (event: TouchEvent) => {
    const touchStart = readerTouchStartRef.current;
    const touch = event.changedTouches[0];
    readerTouchStartRef.current = null;

    if (!touchStart || event.changedTouches.length !== 1 || touchStart.moved || Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y) > READER_TOUCH_MOVE_TOLERANCE) {
      suppressReaderClickUntilRef.current = Date.now() + READER_CLICK_SUPPRESSION_MS;
    }
  };

  const handleReaderTouchCancel = () => {
    readerTouchStartRef.current = null;
    suppressReaderClickUntilRef.current = Date.now() + READER_CLICK_SUPPRESSION_MS;
  };

  const readerInteractionProps = {
    onClick: handleReaderClick,
    onTouchStart: handleReaderTouchStart,
    onTouchMove: handleReaderTouchMove,
    onTouchEnd: handleReaderTouchEnd,
    onTouchCancel: handleReaderTouchCancel
  };

  const sourceIconItems = sourceEntries.slice(0, 2).map((source) => (
    <span key={source.id} title={source.name} aria-label={source.name} className="flex h-8 w-8 shrink-0 leading-none sm:h-9 sm:w-9">
      <SourceIcon
        source={source}
        className="h-8 w-8 outline outline-2 outline-white sm:h-9 sm:w-9"
      />
    </span>
  ));
  const sourceIconStack = sourceEntries.length > 1 ? (aiGroupedStory ? (
    <div
      className="inline-flex rounded-full p-0.5"
      style={AI_ACCENT_GRADIENT_STYLE}
      aria-label={t('aiGroupedStory')}
      title={t('aiGroupedStory')}
    >
      <div className="flex -space-x-2 rounded-full bg-surface p-1">
        {sourceIconItems}
      </div>
    </div>
  ) : (
    <div className="flex -space-x-2 rounded-full bg-surface p-1 ring-1 ring-sky-200" aria-label={t('sources')}>
      {sourceIconItems}
    </div>
  )) : (sourceIconItems[0] || null);
  const sourceSummary = getSourceSummary(group, sourceEntries);
  const publishedAt = getPublishedAt(group, locale);
  const topicBadges = topicEntries.length > 0 ? (
    <div className="flex w-fit shrink-0 -space-x-2 text-xs font-medium text-ink-muted">
      {topicEntries.map(({ topic, source }) => {
        const { Icon, iconBadgeClassName } = getTopicPresentation(topic);
        const localizedTopic = getLocalizedTopic(topic, locale);
        const isAiTopic = source === 'ai';

        if (isAiTopic) {
          return (
            <span
              key={topic}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full p-[1.5px]"
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
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${iconBadgeClassName}`}
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
    <div className="relative ml-auto flex items-center justify-end gap-1.5 sm:gap-2">
      <ShareStatusBubble
        shareState={shareState}
        t={t}
        className="share-status-pill-from-button z-20 mr-0 max-w-[min(16rem,calc(100vw-8rem))]"
      />
      <button
        type="button"
        onClick={openOriginalSource}
        disabled={!safeOriginalUrl}
        className="ui-icon-button"
        aria-label={t('openOriginalSource')}
        title={safeOriginalUrl ? t('openOriginalSourceHelp') : t('openOriginalSourceUnavailable')}
      >
        <ExternalLink className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onToggleReadLater?.(group)}
        disabled={readLaterUpdating}
        className={`ui-icon-button ${group.readLater ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100' : ''}`}
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
        className="ui-icon-button"
        aria-label={t('shareArticle')}
      >
        <Share2 className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <article className="relative flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface md:h-full">
      <div className="flex min-w-0 items-center gap-2 px-4 pt-4 sm:gap-3 sm:px-5 sm:pt-5">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          {sourceIconStack}
          <div className="min-w-0 flex-1">
            {sourceSummary ? (
              <p className="truncate text-sm font-medium text-ink-heading">{sourceSummary}</p>
            ) : null}
            {publishedAt ? (
              <time
                dateTime={publishedAt.iso}
                aria-label={t('publishedAt', { date: publishedAt.label })}
                className="mt-0.5 inline-flex min-w-0 items-center gap-1.5 text-xs text-ink-subtle"
              >
                <Clock3 className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-hidden="true" />
                <span className="truncate">{publishedAt.label}</span>
              </time>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col px-4 py-4 sm:px-5">
        <h2 className="text-lg font-semibold leading-7 tracking-tight text-ink-heading sm:text-xl md:min-h-14">
          <button
            type="button"
            className="block w-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2"
            title={t('readHereHelp')}
            {...readerInteractionProps}
          >
            <span className="line-clamp-2">{group.title}</span>
          </button>
        </h2>
      </div>

      {imageUrl ? (
        <button
          type="button"
          className="relative mt-auto block aspect-video w-full shrink-0 cursor-pointer overflow-hidden border-y border-line-soft bg-surface-raised text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400"
          aria-label={group.title}
          title={t('readHereHelp')}
          {...readerInteractionProps}
        >
          <img
            src={imageUrl}
            alt={isGenericNewsCover(imageUrl) ? fallbackImageAlt : group.title}
            loading="lazy"
            className="block h-full w-full object-cover"
            onError={() => {
              if (!showImages) {
                setImageUrl('');
                return;
              }

              setImageUrl((current) => (isGenericNewsCover(current) ? '' : fallbackImageUrl));
            }}
          />
        </button>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-2 px-3 py-2 sm:px-4">
        {topicBadges}
        {shareControls}
      </div>
    </article>
  );
});

NewsCard.displayName = 'NewsCard';

export default NewsCard;
