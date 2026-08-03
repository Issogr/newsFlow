import type { TopicEntry } from '../types';

type TopicInput = TopicEntry | string;

export function addTopicEntry(topicMap: Map<string, TopicEntry>, entry: TopicInput, options: { preserveEntryFields?: boolean } = {}) {
  const entryObject = typeof entry === 'object' ? entry : undefined;
  const topic = String(entryObject?.topic || entry || '').trim();
  if (!topic) {
    return;
  }

  const key = topic.toLowerCase();
  const current = topicMap.get(key);
  const source = String(entryObject?.source || current?.source || '').trim().toLowerCase();
  const nextEntry: TopicEntry = entryObject && options.preserveEntryFields
    ? { ...entryObject, topic, source }
    : { topic, source };

  if (!current || nextEntry.source === 'ai') {
    topicMap.set(key, nextEntry);
  }
}
