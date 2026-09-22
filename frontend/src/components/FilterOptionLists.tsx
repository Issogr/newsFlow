import { Check } from 'lucide-react';
import { getLocalizedTopic } from '../i18n';
import { getTopicPresentation } from '../topicPresentation';
import SourceIcon from './SourceIcon';
import type { AvailableTopic, Locale, NewsSource } from '../types';

export function SourceFilterList({ sources, activeSourceIds, emptyLabel, onToggleSource }: { sources: NewsSource[]; activeSourceIds: string[]; emptyLabel: string; onToggleSource: (sourceId: string) => void }) {
  if (sources.length === 0) {
    return <p className="text-sm text-ink-subtle">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {sources.map((source) => {
        const isActive = activeSourceIds.includes(source.id);
        return (
          <button
            key={source.id}
            type="button"
            onClick={() => onToggleSource(source.id)}
            aria-pressed={isActive}
            className={`inline-flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-sm font-medium transition-colors ${
              isActive
                ? 'border-sky-600 bg-sky-600 text-white shadow-sm'
                : 'border-sky-200 bg-surface text-sky-900 hover:border-sky-300 hover:bg-sky-50'
            }`}
          >
            <SourceIcon source={source} />
            <span>{source.name}</span>
            {isActive && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            {(source.count || 0) > 0 && (
              <span className={`rounded-full px-2 py-0.5 text-xs ${isActive ? 'bg-white/20 text-white' : 'bg-surface-translucent text-sky-700'}`}>
                {source.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TopicFilterList({ topics, activeTopics, emptyLabel, locale, onToggleTopic }: { topics: AvailableTopic[]; activeTopics: string[]; emptyLabel: string; locale: Locale; onToggleTopic: (topic: string) => void }) {
  if (topics.length === 0) {
    return <p className="text-sm text-ink-subtle">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {topics.map((topic) => {
        const isActive = activeTopics.includes(topic.topic);
        const { Icon, iconBadgeClassName } = getTopicPresentation(topic.topic);
        return (
          <button
            key={topic.topic}
            type="button"
            onClick={() => onToggleTopic(topic.topic)}
            aria-pressed={isActive}
            className={`inline-flex items-center gap-1.5 rounded-full border pl-1 pr-3 py-1 text-sm font-medium transition-colors ${
              isActive
                ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm'
                : 'border-line-strong bg-surface text-ink-body hover:border-line-emphasis hover:bg-hover-soft'
            }`}
          >
            <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors ${isActive ? 'bg-white/20 text-white' : iconBadgeClassName}`}>
              <Icon className="h-3 w-3" aria-hidden="true" />
            </span>
            <span>{getLocalizedTopic(topic.topic, locale)}</span>
            {isActive && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            <span className={`rounded-full px-2 py-0.5 text-xs ${isActive ? 'bg-white/20 text-white' : 'bg-surface-soft text-ink-muted'}`}>
              {topic.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
