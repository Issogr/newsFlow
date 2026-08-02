import { addTopicEntry } from './topicEntries';
import type { FeedCursor, NewsArticle, NewsGroup, NewsSource, TopicEntry } from '../types';
import type { FeedRequestOptions } from '../services/api';

export function getGroupMergeKeys(group: Partial<NewsGroup> = {}) {
  const keys = new Set<string>();

  if (group.id) {
    keys.add(`group:${group.id}`);
  }

  (group.items || []).forEach((item) => {
    const ownerKey = item?.ownerUserId || group.ownerUserId || '';
    if (item?.id) {
      keys.add(`article:${item.id}`);
    }
    if (item?.storyGroupId) {
      keys.add(`story:${ownerKey}:${item.storyGroupId}`);
    }
    if (item?.canonicalUrl) {
      keys.add(`url:${ownerKey}:${item.canonicalUrl}`);
    }
  });

  return keys;
}

function cloneGroup(group: Partial<NewsGroup>): NewsGroup {
  return {
    ...group,
    items: [...(group.items || [])],
    sources: [...(group.sources || [])],
    topics: [...(group.topics || [])],
    topicDetails: [...(group.topicDetails || [])],
    readLaterArticleIds: [...(group.readLaterArticleIds || [])]
  };
}

function getGroupItemKey(item: Partial<NewsArticle> = {}) {
  return item.id || item.canonicalUrl || item.url || item.title || '';
}

function mergeUniqueValues(...lists: Array<Array<string | undefined>>) {
  return [...new Set(lists.flat().filter((value): value is string => Boolean(value)))];
}

function getMergedTopicDetails(incomingGroup: Partial<NewsGroup> = {}, mergedItems: NewsArticle[] = []) {
  const topicMap = new Map<string, TopicEntry>();

  mergedItems.forEach((item) => {
    (item?.topicDetails || []).forEach((entry) => addTopicEntry(topicMap, entry, { preserveEntryFields: true }));
    (item?.topics || []).forEach((entry) => addTopicEntry(topicMap, entry, { preserveEntryFields: true }));
  });
  (incomingGroup.topicDetails || []).forEach((entry) => addTopicEntry(topicMap, entry, { preserveEntryFields: true }));
  (incomingGroup.topics || []).forEach((entry) => addTopicEntry(topicMap, entry, { preserveEntryFields: true }));

  return [...topicMap.values()];
}

function mergeGroupItems(primaryItems: NewsArticle[] = [], secondaryItems: NewsArticle[] = []) {
  const itemMap = new Map<string, NewsArticle>();

  [...primaryItems, ...secondaryItems].forEach((item) => {
    const key = getGroupItemKey(item);
    if (!key) {
      return;
    }

    const existing = itemMap.get(key);
    itemMap.set(key, existing ? { ...existing, ...item } : item);
  });

  return [...itemMap.values()].sort((left, right) => {
    const dateComparison = String(right.pubDate || '').localeCompare(String(left.pubDate || ''));
    return dateComparison || String(right.id || '').localeCompare(String(left.id || ''));
  });
}

export function groupSharesAnyKey(group: Partial<NewsGroup>, keySet: Set<string>) {
  return [...getGroupMergeKeys(group)].some((key) => keySet.has(key));
}

function filterGroupsMatchingCurrent(currentGroups: NewsGroup[] = [], incomingGroups: NewsGroup[] = []) {
  const currentKeys = new Set<string>();
  currentGroups.forEach((group) => {
    getGroupMergeKeys(group).forEach((key) => currentKeys.add(key));
  });

  if (currentKeys.size === 0) {
    return [];
  }

  return incomingGroups.filter((group) => groupSharesAnyKey(group, currentKeys));
}

function mergeGroupIntoTarget(targetGroup: NewsGroup, incomingGroup: NewsGroup) {
  const nextItems = mergeGroupItems(targetGroup.items, incomingGroup.items);
  const primaryItem = nextItems[0] || null;
  const nextTopicDetails = getMergedTopicDetails(incomingGroup, nextItems);

  targetGroup.items = nextItems;
  targetGroup.sources = mergeUniqueValues(targetGroup.sources || [], incomingGroup.sources || [], nextItems.map((item) => item.source));
  targetGroup.topics = nextTopicDetails.map((entry) => entry.topic);
  targetGroup.topicDetails = nextTopicDetails;
  targetGroup.readLater = Boolean(targetGroup.readLater || incomingGroup.readLater);
  targetGroup.readLaterArticleIds = mergeUniqueValues(targetGroup.readLaterArticleIds || [], incomingGroup.readLaterArticleIds || []);

  if (primaryItem) {
    targetGroup.cursorId = primaryItem.id || targetGroup.cursorId;
    targetGroup.title = primaryItem.title || targetGroup.title || incomingGroup.title;
    targetGroup.description = primaryItem.description || targetGroup.description || incomingGroup.description;
    targetGroup.pubDate = primaryItem.pubDate || targetGroup.pubDate;
    targetGroup.url = primaryItem.url || targetGroup.url;
    targetGroup.clickbaitLabel = primaryItem.clickbaitLabel || incomingGroup.clickbaitLabel || '';
    targetGroup.clickbaitScore = primaryItem.clickbaitScore ?? incomingGroup.clickbaitScore ?? null;
    targetGroup.clickbaitSource = primaryItem.clickbaitSource || incomingGroup.clickbaitSource || '';
    targetGroup.clickbaitConfidence = primaryItem.clickbaitConfidence ?? incomingGroup.clickbaitConfidence ?? null;
    targetGroup.clickbaitModel = primaryItem.clickbaitModel || incomingGroup.clickbaitModel || '';
  }
}

export const mergeGroups = (primaryGroups: NewsGroup[], secondaryGroups: NewsGroup[]) => {
  const mergedGroups: NewsGroup[] = [];
  const groupByKey = new Map<string, NewsGroup>();

  const remapGroup = (sourceGroup: NewsGroup, targetGroup: NewsGroup) => {
    groupByKey.forEach((mappedGroup, key) => {
      if (mappedGroup === sourceGroup) {
        groupByKey.set(key, targetGroup);
      }
    });
  };

  const addGroupKeys = (group: NewsGroup) => {
    getGroupMergeKeys(group).forEach((key) => groupByKey.set(key, group));
  };

  [...primaryGroups, ...secondaryGroups].forEach((group) => {
    if (!group) {
      return;
    }

    const groupKeys = getGroupMergeKeys(group);
    const candidates = [...new Set([...groupKeys].map((key) => groupByKey.get(key)).filter((candidate): candidate is NewsGroup => Boolean(candidate)))];
    let targetGroup = candidates[0] || null;

    if (!targetGroup) {
      targetGroup = cloneGroup(group);
      mergedGroups.push(targetGroup);
    } else {
      mergeGroupIntoTarget(targetGroup, group);
    }

    candidates.slice(1).forEach((candidate) => {
      mergeGroupIntoTarget(targetGroup, candidate);
      remapGroup(candidate, targetGroup);
      const candidateIndex = mergedGroups.indexOf(candidate);
      if (candidateIndex !== -1) {
        mergedGroups.splice(candidateIndex, 1);
      }
    });

    addGroupKeys(targetGroup);
  });

  return mergedGroups;
};

export function buildFeedRequestParams({
  activeFilters,
  append,
  cursor,
  forceRefresh,
  includeFilters,
  isReadLaterView,
  page,
  pageSize,
  search,
  signal,
}: {
  activeFilters: { sourceIds: string[]; topics: string[] };
  append: boolean;
  cursor: FeedCursor | null;
  forceRefresh: boolean;
  includeFilters: boolean;
  isReadLaterView: boolean;
  page: number;
  pageSize: number;
  search: string;
  signal: AbortSignal;
}): FeedRequestOptions {
  return {
    page,
    pageSize,
    search,
    sourceIds: activeFilters.sourceIds,
    topics: activeFilters.topics,
    beforePubDate: !isReadLaterView && append ? cursor?.beforePubDate : '',
    beforeId: !isReadLaterView && append ? cursor?.beforeId : '',
    excludeArticleIds: !isReadLaterView && append ? cursor?.excludeArticleIds : [],
    refresh: !isReadLaterView && forceRefresh,
    includeFilters,
    signal
  };
}

export function getLoadedNewsGroups(currentGroups: NewsGroup[], {
  append,
  isReadLaterView,
  maxRetainedGroups,
  mergedItems,
  responseItems,
  silent,
}: {
  append: boolean;
  isReadLaterView: boolean;
  maxRetainedGroups: number;
  mergedItems: NewsGroup[];
  responseItems: NewsGroup[];
  silent: boolean;
}) {
  let nextNews = append ? mergeGroups(currentGroups, responseItems) : mergedItems;

  if (!append && silent) {
    nextNews = mergeGroups(currentGroups, filterGroupsMatchingCurrent(currentGroups, mergedItems));
  }

  if (!append && silent && currentGroups.length > nextNews.length) {
    const preservedTail = currentGroups.slice(nextNews.length);
    nextNews = mergeGroups(nextNews, preservedTail).slice(0, currentGroups.length);
  }

  if (!isReadLaterView && nextNews.length > maxRetainedGroups) {
    nextNews = nextNews.slice(0, maxRetainedGroups);
  }

  return nextNews;
}

export const getSourceReloadSignature = (excludedSourceIds: string[], excludedSubSourceIds: string[], customSources: NewsSource[]) => JSON.stringify({
  excludedSourceIds,
  excludedSubSourceIds,
  customSources: (customSources || []).map((source) => [source.id, source.name, source.url, source.language, source.isActive !== false])
});
