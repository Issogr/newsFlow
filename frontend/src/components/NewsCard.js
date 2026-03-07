import React, { memo } from 'react';
import { BookOpenText, ExternalLink } from 'lucide-react';
import { getDateLocale, getLanguageMeta } from '../i18n';

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

function buildSummary(group, t) {
  const mainItem = group?.items?.[0];
  const content = mainItem?.content || mainItem?.description || group?.description || '';
  const normalized = content.replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return t('noExcerpt');
  }

  return normalized.length > 240 ? `${normalized.slice(0, 240)}...` : normalized;
}

const NewsCard = memo(({ group, activeFilters, toggleFilter, locale, t, onOpenReader }) => {
  if (!group?.items?.length) {
    return null;
  }

  const sourceEntries = getSourceEntries(group);
  const summary = buildSummary(group, t);

  const isTopicActive = (topic) => activeFilters.topics.includes(topic);
  const isSourceActive = (sourceId) => activeFilters.sourceIds.includes(sourceId);
  const languageMeta = getLanguageMeta(group.items[0]?.language, locale);

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-lg">
      <div className="border-b border-slate-100 p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
            {sourceEntries.length > 1 ? t('sourceCount', { count: sourceEntries.length }) : t('singleSource')}
          </span>
          <span
            className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500"
            title={t('newsLanguage', { language: languageMeta.label })}
            aria-label={t('newsLanguage', { language: languageMeta.label })}
          >
            {languageMeta.emoji}
          </span>
          <span>{formatPublicationDate(group.pubDate, locale)}</span>
        </div>

        <h2 className="text-lg font-semibold leading-tight text-slate-900">
          {group.title}
        </h2>

        <div className="mt-4 flex flex-wrap gap-2">
          {sourceEntries.map((source) => (
            <button
              key={source.id}
              type="button"
              onClick={() => toggleFilter('sourceIds', source.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                isSourceActive(source.id)
                  ? 'bg-sky-600 text-white'
                  : 'bg-sky-100 text-sky-800 hover:bg-sky-200'
              }`}
              aria-pressed={isSourceActive(source.id)}
            >
              {source.name}
            </button>
          ))}
        </div>

        {group.topics?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {group.topics.map((topic) => (
              <button
                key={topic}
                type="button"
                onClick={() => toggleFilter('topics', topic)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  isTopicActive(topic)
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                }`}
                aria-pressed={isTopicActive(topic)}
              >
                {topic}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 p-5">
        <p className="text-sm leading-6 text-slate-600">{summary}</p>
      </div>

      <div className="border-t border-slate-100 px-5 py-4">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onOpenReader(group, group.items[0]?.id)}
            className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <BookOpenText className="mr-2 h-4 w-4" />
            {t('readerMode')}
          </button>
          <a
            href={group.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700"
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
