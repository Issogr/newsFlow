import React, { memo } from 'react';
import { BookOpenText, CalendarDays, ExternalLink, Rss, Tags } from 'lucide-react';
import { getDateLocale } from '../i18n';

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

const NewsCard = memo(({ group, activeFilters, toggleFilter, locale, t, onOpenReader }) => {
  if (!group?.items?.length) {
    return null;
  }

  const sourceEntries = getSourceEntries(group);

  const isTopicActive = (topic) => activeFilters.topics.includes(topic);
  const isSourceActive = (sourceId) => activeFilters.sourceIds.includes(sourceId);

  return (
    <article className="flex h-full min-h-[20rem] flex-col overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-xl">
      <div className="flex flex-1 flex-col p-5">
        <h2 className="text-xl font-semibold leading-snug text-slate-900">
          {group.title}
        </h2>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5">
            <CalendarDays className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />
            {formatPublicationDate(group.pubDate, locale)}
          </span>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
            <Rss className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t('sources')}</span>
          </div>
          <div className="flex min-h-7 flex-wrap content-start gap-2">
            {sourceEntries.map((source) => (
              <button
                key={source.id}
                type="button"
                onClick={() => toggleFilter('sourceIds', source.id)}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  isSourceActive(source.id)
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'bg-sky-100 text-sky-900 hover:bg-sky-200'
                }`}
                aria-pressed={isSourceActive(source.id)}
              >
                {source.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
            <Tags className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t('topics')}</span>
          </div>
          <div className="flex min-h-7 flex-wrap content-start gap-2">
            {group.topics?.map((topic) => (
              <button
                key={topic}
                type="button"
                onClick={() => toggleFilter('topics', topic)}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  isTopicActive(topic)
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200'
                }`}
                aria-pressed={isTopicActive(topic)}
              >
                {topic}
              </button>
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
          <a
            href={group.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-700"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            {t('openOriginalSource')}
          </a>
        </div>
      </div>
    </article>
  );
});

NewsCard.displayName = 'NewsCard';

export default NewsCard;
