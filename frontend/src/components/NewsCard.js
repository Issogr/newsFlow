import React, { memo, useEffect, useState } from 'react';
import {
  BookOpenText,
  CalendarDays,
  ExternalLink,
  Rss,
} from 'lucide-react';
import { getDateLocale, getLocalizedTopic } from '../i18n';
import { getTopicPresentation } from '../topicPresentation';
import { getSafeExternalUrl } from '../utils/urlSafety';

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

const NewsCard = memo(({ group, locale, t, onOpenReader }) => {
  const hasItems = Boolean(group?.items?.length);

  const sourceEntries = getSourceEntries(group);
  const safeOriginalUrl = getSafeExternalUrl(group?.url);
  const safeImageUrl = getGroupImageUrl(group);
  const [imageVisible, setImageVisible] = useState(Boolean(safeImageUrl));

  useEffect(() => {
    setImageVisible(Boolean(safeImageUrl));
  }, [safeImageUrl]);

  if (!hasItems) {
    return null;
  }

  return (
    <article className="flex h-full min-h-[20rem] flex-col overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-xl">
      {imageVisible ? (
        <div className="aspect-[16/9] w-full overflow-hidden bg-slate-100">
          <img
            src={safeImageUrl}
            alt={group.title}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setImageVisible(false)}
          />
        </div>
      ) : null}
      <div className="flex flex-1 flex-col p-5">
        <h2 className="text-xl font-semibold leading-snug text-slate-900">
          {group.title}
        </h2>

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

      </div>

      <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => onOpenReader(group, group.items[0]?.id)}
            className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
          >
            <BookOpenText className="mr-2 h-4 w-4" />
            {t('readerMode')}
          </button>
          {safeOriginalUrl ? (
            <a
              href={safeOriginalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-700"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              {t('openOriginalSource')}
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex w-full cursor-not-allowed items-center justify-center rounded-xl bg-slate-300 px-4 py-3 text-sm font-medium text-slate-600"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              {t('openOriginalSource')}
            </button>
          )}
        </div>
      </div>
    </article>
  );
});

NewsCard.displayName = 'NewsCard';

export default NewsCard;
