import { useEffect, useRef, useState } from 'react';
import { Rss, Tags, X } from 'lucide-react';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import { SourceFilterList, TopicFilterList } from './FilterOptionLists';
import type { ActiveFilters, AvailableTopic, Locale, NewsSource, Translator } from '../types';

export default function FeedFilterPanel({ sources, topics, activeFilters, onToggle, onClear, onClose, locale, t }: {
  sources: NewsSource[];
  topics: AvailableTopic[];
  activeFilters: ActiveFilters;
  onToggle: (type: keyof ActiveFilters, value: string) => void;
  onClear: () => void;
  onClose: (restoreFocus?: boolean) => void;
  locale: Locale;
  t: Translator;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<'sources' | 'topics'>(() =>
    !activeFilters.sourceIds.length && (activeFilters.topics.length || !sources.length) ? 'topics' : 'sources'
  );
  useEffect(() => {
    panelRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus({ preventScroll: true });
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose(true);
      }
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [onClose]);
  useOnClickOutside(panelRef, (event) => {
    if (!(event.target instanceof Element && event.target.closest('[aria-controls="feed-filters"]'))) onClose();
  });
  // Search or source changes can drop a selected topic from the server's top topics.
  const missingTopics = activeFilters.topics.filter((name) => !topics.some(({ topic }) => topic === name));
  const count = activeFilters.sourceIds.length + activeFilters.topics.length;
  return (
    <div
      id="feed-filters"
      ref={panelRef}
      role="dialog"
      aria-label={t('feedFilters')}
      aria-describedby="feed-filters-help"
      className="ui-popover feed-filter-bubble fixed inset-x-[max(1rem,env(safe-area-inset-left),env(safe-area-inset-right))] bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-h-[min(55dvh,25rem)] max-w-md origin-bottom flex-col text-ink-body md:absolute md:inset-x-auto md:top-[calc(100%+0.75rem)] md:right-0 md:bottom-auto md:w-[26rem] md:origin-top-right"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Element && !event.currentTarget.contains(next) && !next.closest('[aria-controls="feed-filters"]')) onClose();
      }}
    >
      <p className="sr-only" id="feed-filters-help">{t('feedFilterHelp')}</p>
      <div className="flex shrink-0 items-center gap-2 border-b border-line-soft p-2">
        <div className="flex flex-1 gap-1 rounded-xl bg-surface-raised p-1">
          {(['sources', 'topics'] as const).map((key) => {
            const Icon = key === 'sources' ? Rss : Tags;
            const selected = key === 'sources' ? activeFilters.sourceIds.length : activeFilters.topics.length;
            return (
              <button key={key} type="button" aria-pressed={section === key} onClick={() => setSection(key)}
                className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold ${
                  section === key ? 'bg-surface text-ink-heading shadow-sm' : 'text-ink-muted hover:text-ink-heading'
                }`}>
                <Icon className={`h-4 w-4 ${key === 'sources' ? 'text-sky-700' : 'text-emerald-700'}`} aria-hidden="true" />
                {t(key)}{selected > 0 && <span className="rounded-full bg-surface-inset px-1.5 text-xs">{selected}</span>}
              </button>
            );
          })}
        </div>
        <button type="button" className="ui-icon-button" aria-label={t('close')} onClick={() => onClose(true)}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <div key={section} className="min-h-0 overflow-y-auto overscroll-contain p-3">
        {section === 'sources' ? (
          <SourceFilterList
            sources={sources}
            activeSourceIds={activeFilters.sourceIds}
            emptyLabel={t('noFilterSources')}
            onToggleSource={(id) => onToggle('sourceIds', id)}
          />
        ) : (
          <TopicFilterList
            topics={[...topics, ...missingTopics.map((topic) => ({ topic }))]}
            activeTopics={activeFilters.topics}
            locale={locale}
            emptyLabel={t('noFilterTopics')}
            onToggleTopic={(topic) => onToggle('topics', topic)}
          />
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-line-soft px-3 py-1">
        <span className="text-sm text-ink-muted" aria-live="polite">{t('selectedFilterCount', { count })}</span>
        <button type="button" disabled={!count} onClick={onClear}
          className="min-h-10 rounded-lg px-2 text-sm font-semibold text-sky-700 hover:bg-hover-soft disabled:opacity-50">
          {t('clearFeedFilters')}
        </button>
      </div>
    </div>
  );
}
