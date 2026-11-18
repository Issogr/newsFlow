import { memo, useId, useRef, useState, type TouchEvent } from 'react';
import {
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  Ellipsis,
  ExternalLink,
  Share2,
} from 'lucide-react';
import { getLocalizedTopic } from '../i18n';
import { getSafeExternalUrl } from '../utils/urlSafety';
import { addTopicEntry } from '../utils/topicEntries';
import genericCover from '../assets/generic-news-cover.webp';
import genericCover2 from '../assets/generic-news-cover-2.webp';
import genericCover3 from '../assets/generic-news-cover-3.webp';
import genericCover4 from '../assets/generic-news-cover-4.webp';
import useShareArticle from '../hooks/useShareArticle';
import { AI_ACCENT_GRADIENT_STYLE, getTopicPresentation } from '../topicPresentation';
import ShareStatusBubble from './ShareStatusBubble';
import SourceComparison from './SourceComparison';
import SourceIcon from './SourceIcon';
import type { Locale, NewsArticle, NewsGroup, TopicEntry, Translator } from '../types';

const GENERIC_COVERS = [genericCover, genericCover2, genericCover3, genericCover4];
const READER_TOUCH_MOVE_TOLERANCE = 8;
const READER_CLICK_SUPPRESSION_MS = 500;

function isGifImageUrl(imageUrl: string) {
  try {
    return new URL(String(imageUrl || '')).pathname.toLowerCase().endsWith('.gif');
  } catch {
    return false;
  }
}

function getSourceEntries(group: NewsGroup) {
  const sourceMap = new Map<string, NewsArticle>();

  (group?.items || []).forEach((item) => {
    const sourceKey = item.sourceId || item.source;
    if (!sourceKey) return;
    const existing = sourceMap.get(sourceKey);
    if (!existing || (!existing.id && item.id)) {
      sourceMap.set(sourceKey, item);
    }
  });

  return [...sourceMap.values()];
}

function countSourceArticles(group: NewsGroup, sourceKey: string) {
  const itemIds = new Set<string>();

  (group?.items || []).forEach((item) => {
    const key = item?.id || item?.url || item?.title;
    if (key && (item.sourceId || item.source) === sourceKey) {
      itemIds.add(key);
    }
  });

  return itemIds.size;
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
  const [fallbackCover] = useState(() => GENERIC_COVERS[Math.floor(Math.random() * GENERIC_COVERS.length)]);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const coverUrl = [safeImageUrl, fallbackCover].find(url => url && !failedImages.includes(url));
  const [comparing, setComparing] = useState(false);
  const comparisonId = useId();
  const actionsId = useId();
  const { shareState, shareArticle } = useShareArticle();
  const readerTouchStartRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const suppressReaderClickUntilRef = useRef(0);
  const lastReaderOpenAtRef = useRef(0);

  if (!hasItems) {
    return null;
  }

  const openReader = (articleId = group.items[0]?.id) => {
    const now = Date.now();
    if (now < suppressReaderClickUntilRef.current || (lastReaderOpenAtRef.current && now >= lastReaderOpenAtRef.current && now - lastReaderOpenAtRef.current < 400)) {
      return;
    }

    lastReaderOpenAtRef.current = now;
    onOpenReader(group, articleId);
  };

  const openOriginalSource = () => {
    if (!safeOriginalUrl) {
      return;
    }

    window.open(safeOriginalUrl, '_blank', 'noopener,noreferrer');
  };

  const handleReaderTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      readerTouchStartRef.current = null;
      return;
    }

    const touch = event.touches[0];
    suppressReaderClickUntilRef.current = 0;
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

  const multiSource = sourceEntries.length > 1;
  const aiGrouped = multiSource && group.items.some((item) => item.storyGroupId && item.aiStoryGroupStatus?.toLowerCase() === 'matched');
  const visibleSources = sourceEntries.slice(0, 2);
  const sourceNames = visibleSources.map((item) => item.source || item.sourceId).join(' · ');
  const articleCount = sourceEntries.length === 1 ? countSourceArticles(group, sourceEntries[0].sourceId || sourceNames) : 0;
  const sourceSummary = articleCount > 1
    ? t('articlesFromSource', { count: articleCount, source: sourceNames })
    : sourceNames;
  const publishedAt = getPublishedAt(group, locale);
  return (
    <article
      className="feed-card-enter flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5 md:row-span-3 md:grid md:grid-rows-subgrid"
      onTouchStart={handleReaderTouchStart}
      onTouchMove={handleReaderTouchMove}
      onTouchEnd={handleReaderTouchEnd}
      onTouchCancel={handleReaderTouchCancel}
    >
      {(topicEntries.length > 0 || publishedAt) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {topicEntries.map(({ topic, source }) => {
            const { Icon, iconBadgeClassName } = getTopicPresentation(topic);
            return (
              <span key={topic} className="inline-flex max-w-full rounded-full p-px" style={source === 'ai' ? AI_ACCENT_GRADIENT_STYLE : undefined}>
                <span className={`inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${iconBadgeClassName}`}>
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="wrap-anywhere">{getLocalizedTopic(topic, locale)}</span>
                </span>
              </span>
            );
          })}
          {publishedAt && (
            <time dateTime={publishedAt.iso} aria-label={t('publishedAt', { date: publishedAt.label })} className="ml-auto text-xs text-ink-subtle">
              {publishedAt.label}
            </time>
          )}
        </div>
      )}

      <div className="flex items-start gap-3 md:row-start-2 md:flex-col">
        <h2 className="min-w-0 flex-1 text-xl font-semibold leading-tight tracking-tight text-ink-heading md:text-2xl">
          <button
            type="button"
            className="block rounded-sm text-left text-pretty wrap-anywhere"
            onClick={() => openReader()}
            title={t('readHereHelp')}
          >
            {group.title}
          </button>
        </h2>
        {showImages && coverUrl && (
          <button
            type="button"
            className="aspect-square w-20 shrink-0 overflow-hidden rounded-xl bg-surface-raised sm:w-24 md:aspect-video md:w-full"
            aria-label={group.title}
            title={t('readHereHelp')}
            onClick={() => openReader()}
          >
            <img
              src={coverUrl}
              alt={coverUrl === fallbackCover ? t('genericNewsCoverAlt') : group.title}
              loading="lazy"
              className="h-full w-full object-cover"
              onError={() => setFailedImages(previous => [...previous, coverUrl])}
            />
          </button>
        )}
      </div>

      <div className="flex flex-wrap content-start items-center gap-2 border-t border-line-soft pt-2 md:row-start-3">
        {sourceSummary && (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className="inline-flex shrink-0 rounded-full p-0.5"
              style={aiGrouped ? AI_ACCENT_GRADIENT_STYLE : undefined}
              role={aiGrouped ? 'group' : undefined}
              aria-label={aiGrouped ? t('aiGroupedStory') : undefined}
              title={aiGrouped ? t('aiGroupedStory') : undefined}
            >
              <span className="flex -space-x-2 rounded-full bg-surface p-0.5">
                {visibleSources.map((item) => (
                  <SourceIcon
                    key={item.sourceId || item.source}
                    source={{ name: item.source || item.sourceId || '', iconUrl: item.sourceIconUrl }}
                    className="h-6 w-6 outline-2 outline-surface"
                  />
                ))}
              </span>
            </span>
            <div className="min-w-0">
              <p className="wrap-anywhere text-sm font-medium text-ink-body">{sourceSummary}</p>
              {multiSource && (
                <button
                  type="button"
                  aria-expanded={comparing}
                  aria-controls={comparisonId}
                  onClick={() => setComparing(!comparing)}
                  className="inline-flex min-h-11 items-center gap-1 rounded-sm text-left text-sm font-semibold text-sky-700"
                >
                  {t('compareSources', { count: sourceEntries.length })}
                  <ChevronDown className={`h-4 w-4 shrink-0 ${comparing ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        )}
        <div className="relative ml-auto flex items-center gap-1">
          <ShareStatusBubble shareState={shareState} t={t} className="absolute right-0 bottom-full z-10 mb-1" />
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
            className="ui-icon-button"
            popoverTarget={actionsId}
            style={{ anchorName: `--${actionsId}` }}
            aria-label={t('storyActions')}
            title={t('storyActions')}
          >
            <Ellipsis className="h-5 w-5" />
          </button>
          <div popover="auto" id={actionsId} style={{ positionAnchor: `--${actionsId}` }} className="ui-popover story-actions p-1 text-sm text-ink-body">
            <button
              type="button"
              onClick={openOriginalSource}
              disabled={!safeOriginalUrl}
              popoverTarget={actionsId}
              popoverTargetAction="hide"
              className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 hover:bg-hover-soft disabled:opacity-50"
              title={safeOriginalUrl ? t('openOriginalSourceHelp') : t('openOriginalSourceUnavailable')}
            >
              <ExternalLink className="h-4 w-4" />{t('openOriginalSource')}
            </button>
            <button
              type="button"
              onClick={() => shareArticle({ url: safeOriginalUrl, title: group.title })}
              disabled={!safeOriginalUrl}
              popoverTarget={actionsId}
              popoverTargetAction="hide"
              className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 hover:bg-hover-soft disabled:opacity-50"
            >
              <Share2 className="h-4 w-4" />{t('shareArticle')}
            </button>
          </div>
        </div>
        {multiSource && (
          <div id={comparisonId} className="min-w-0 basis-full" hidden={!comparing}>
            {comparing && <SourceComparison items={sourceEntries} t={t} onOpen={openReader} />}
          </div>
        )}
      </div>
    </article>
  );
});

NewsCard.displayName = 'NewsCard';

export default NewsCard;
