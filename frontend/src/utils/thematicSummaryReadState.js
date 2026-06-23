const READ_THEMATIC_SUMMARIES_STORAGE_PREFIX = 'newsflow-read-thematic-summaries';

export function getReadThematicSummariesStorageKey(currentUser) {
  const userKey = currentUser?.user?.id || currentUser?.user?.username || 'anonymous';
  return `${READ_THEMATIC_SUMMARIES_STORAGE_PREFIX}:${userKey}`;
}

export function getStoredReadThematicSummaryIds(storageKey) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
    return Array.isArray(parsed) ? parsed.map((id) => String(id || '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function setStoredReadThematicSummaryIds(storageKey, summaryIds = []) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...new Set(summaryIds)]));
  } catch {
    // Keep unread indicators in memory when browser storage is unavailable.
  }
}

export function mergeReadThematicSummaryIds(...summaryIdGroups) {
  return [...new Set(summaryIdGroups
    .flatMap((summaryIds) => (Array.isArray(summaryIds) ? summaryIds : []))
    .map((summaryId) => String(summaryId || '').trim())
    .filter(Boolean))];
}
