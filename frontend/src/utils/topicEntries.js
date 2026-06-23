export function addTopicEntry(topicMap, entry, options = {}) {
  const topic = String(entry?.topic || entry || '').trim();
  if (!topic) {
    return;
  }

  const key = topic.toLowerCase();
  const current = topicMap.get(key);
  const source = String(entry?.source || current?.source || '').trim().toLowerCase();
  const nextEntry = entry && typeof entry === 'object' && options.preserveEntryFields
    ? { ...entry, topic, source }
    : { topic, source };

  if (!current || nextEntry.source === 'ai') {
    topicMap.set(key, nextEntry);
  }
}
