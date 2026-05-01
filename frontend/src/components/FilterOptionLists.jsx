import React from 'react';
import { getLocalizedTopic } from '../i18n';
import { getTopicPresentation } from '../topicPresentation';
import SourceIcon from './SourceIcon';

export function SourceFilterList({ sources, activeSourceIds, emptyLabel, onToggleSource }) {
  if (sources.length === 0) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>;
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
            className={`inline-flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-sm font-medium transition-colors ${
              isActive
                ? 'border-sky-600 bg-sky-600 text-white shadow-sm'
                : 'border-sky-200 bg-white text-sky-900 hover:border-sky-300 hover:bg-sky-50'
            }`}
          >
            <SourceIcon source={source} />
            <span>{source.name}</span>
            {source.count > 0 && (
              <span className={`rounded-full px-2 py-0.5 text-xs ${isActive ? 'bg-white/20 text-white' : 'bg-white/80 text-sky-700'}`}>
                {source.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TopicFilterList({ topics, activeTopics, emptyLabel, locale, onToggleTopic }) {
  if (topics.length === 0) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>;
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
            className={`inline-flex items-center gap-1.5 rounded-full border pl-1 pr-3 py-1 text-sm font-medium transition-colors ${
              isActive
                ? 'border-slate-900 bg-white text-slate-950 shadow-sm'
                : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'
            }`}
          >
            <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors ${iconBadgeClassName}`}>
              <Icon className="h-3 w-3" aria-hidden="true" />
            </span>
            <span>{getLocalizedTopic(topic.topic, locale)}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${isActive ? 'bg-slate-100 text-slate-700' : 'bg-slate-50 text-slate-600'}`}>
              {topic.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
