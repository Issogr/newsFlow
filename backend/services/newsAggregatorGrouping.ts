const crypto = require('crypto');
const topicNormalizer = require('./topicNormalizer');
const {
  getCanonicalSourceId,
  getCanonicalSourceName,
  getSourceVariantLabel
} = require('../utils/sourceCatalog');
const { normalizeArticleUrl } = require('../utils/articleIdentity');
import type { DynamicRecord, NewsArticle } from '../utils/types';

type Article = NewsArticle & DynamicRecord;
interface NewsGroup extends DynamicRecord {
  id: string;
  items: Article[];
  pubDate: string;
}
interface GroupBucket {
  ownerKey: string;
  latestTimestamp: number;
  items: Article[];
}

const TITLE_GROUP_WINDOW_MS = 12 * 60 * 60 * 1000;
const TITLE_STOP_WORDS = new Set([
  'a', 'ad', 'al', 'alla', 'and', 'con', 'da', 'dal', 'dalla', 'de', 'del', 'della', 'di', 'e', 'for', 'from', 'il', 'in', 'la', 'le', 'lo', 'of', 'on', 'per', 'the', 'to', 'un', 'una', 'with'
]);

function getStableArticleKey(item: Partial<Article> | null | undefined) {
  if (!item || typeof item !== 'object') {
    return '';
  }

  return item.id || item.url || item.title || '';
}

function buildStableGroupId(items: Article[]) {
  const stableKeys = (Array.isArray(items) ? items : [])
    .map(getStableArticleKey)
    .filter(Boolean)
    .sort();

  if (stableKeys.length === 0) {
    return `group-${Date.now()}`;
  }

  return `group-${crypto.createHash('sha1').update(stableKeys.join('|')).digest('hex').slice(0, 16)}`;
}

function sortGroupsByPubDate(groups: NewsGroup[] = []) {
  return groups.sort((left, right) => {
    const dateComparison = new Date(right.pubDate).getTime() - new Date(left.pubDate).getTime();
    return dateComparison || String(right.id || '').localeCompare(String(left.id || ''));
  });
}

function normalizeTitleKey(title = '') {
  return String(title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !TITLE_STOP_WORDS.has(token))
    .slice(0, 12)
    .join(' ');
}

function getArticleTimestamp(item: Partial<Article> = {}) {
  const parsed = Date.parse(item.pubDate || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function getGroupOwnerKey(item: Partial<Article> = {}) {
  return item.ownerUserId || '';
}

function getCanonicalGroupKey(item: Partial<Article> = {}) {
  const canonicalUrl = normalizeArticleUrl(item.canonicalUrl || item.url || '');
  return canonicalUrl ? `url:${getGroupOwnerKey(item)}:${canonicalUrl}` : '';
}

function getStoryGroupKey(item: Partial<Article> = {}) {
  const storyGroupId = String(item.storyGroupId || '').trim();
  return storyGroupId ? `story:${getGroupOwnerKey(item)}:${storyGroupId}` : '';
}

function getTitleGroupKey(item: Partial<Article> = {}) {
  const titleKey = normalizeTitleKey(item.title);
  return titleKey ? `title:${getGroupOwnerKey(item)}:${titleKey}` : '';
}

function canGroupByTitle(item: Article, group: GroupBucket | null | undefined) {
  if (!group || getGroupOwnerKey(item) !== group.ownerKey) {
    return false;
  }

  const itemTimestamp = getArticleTimestamp(item);
  if (!itemTimestamp || !group.latestTimestamp) {
    return false;
  }

  return Math.abs(group.latestTimestamp - itemTimestamp) <= TITLE_GROUP_WINDOW_MS;
}

function addGroupCandidate(candidates: GroupBucket[], group: GroupBucket | null | undefined) {
  if (group && !candidates.includes(group)) {
    candidates.push(group);
  }
}

function remapGroupReferences(groupMaps: Array<Map<string, GroupBucket>>, sourceGroup: GroupBucket, targetGroup: GroupBucket) {
  groupMaps.forEach((groupMap) => {
    groupMap.forEach((mappedGroup, key) => {
      if (mappedGroup === sourceGroup) {
        groupMap.set(key, targetGroup);
      }
    });
  });
}

function mergeGroupIntoTarget(groups: GroupBucket[], groupMaps: Array<Map<string, GroupBucket>>, targetGroup: GroupBucket | null, sourceGroup: GroupBucket | null) {
  if (!targetGroup || !sourceGroup || targetGroup === sourceGroup) {
    return;
  }

  targetGroup.items.push(...sourceGroup.items);
  targetGroup.latestTimestamp = Math.max(targetGroup.latestTimestamp || 0, sourceGroup.latestTimestamp || 0);
  remapGroupReferences(groupMaps, sourceGroup, targetGroup);

  const sourceIndex = groups.indexOf(sourceGroup);
  if (sourceIndex !== -1) {
    groups.splice(sourceIndex, 1);
  }
}

function addUniqueTopicDetails(topicMap: Map<string, DynamicRecord>, entries: unknown[] = []) {
  entries.forEach((entry) => {
    const entryRecord = entry && typeof entry === 'object' ? entry as DynamicRecord : null;
    const topic = String(entryRecord?.topic || entry || '').trim();
    if (!topic) {
      return;
    }

    const key = topic.toLowerCase();
    const current = topicMap.get(key);
    const nextEntry: DynamicRecord = entryRecord ? { ...entryRecord, topic } : { topic };

    if (!current || nextEntry.source === 'ai') {
      topicMap.set(key, nextEntry);
    }
  });
}

function createGroupFromItems(items: Article[] = []): NewsGroup | null {
  const sortedItems = [...items].sort((left, right) => getArticleTimestamp(right) - getArticleTimestamp(left));
  const primaryItem = sortedItems[0];

  if (!primaryItem) {
    return null;
  }

  const sourceNames = new Set<string>();
  const topicMap = new Map<string, DynamicRecord>();

  sortedItems.forEach((item) => {
    if (item.source) {
      sourceNames.add(item.source);
    }

    addUniqueTopicDetails(topicMap, Array.isArray(item.topicDetails) ? item.topicDetails : []);
    addUniqueTopicDetails(topicMap, item.topics || []);
  });

  const topicDetails = [...topicMap.values()];

  return {
    id: buildStableGroupId(sortedItems),
    cursorId: primaryItem.id,
    items: sortedItems,
    ownerUserId: primaryItem.ownerUserId || null,
    sources: [...sourceNames],
    title: primaryItem.title,
    description: primaryItem.description,
    pubDate: primaryItem.pubDate,
    clickbaitLabel: primaryItem.clickbaitLabel || '',
    clickbaitScore: Number.isFinite(Number(primaryItem.clickbaitScore)) ? Number(primaryItem.clickbaitScore) : null,
    clickbaitSource: primaryItem.clickbaitSource || '',
    clickbaitConfidence: Number.isFinite(Number(primaryItem.clickbaitConfidence)) ? Number(primaryItem.clickbaitConfidence) : null,
    clickbaitModel: primaryItem.clickbaitModel || '',
    topics: topicDetails.map((entry) => entry.topic),
    topicDetails,
    url: primaryItem.url
  } as NewsGroup;
}

function groupSimilarNews(newsItems: Article[]): NewsGroup[] {
  const groups: GroupBucket[] = [];
  const groupsByStoryKey = new Map<string, GroupBucket>();
  const groupsByCanonicalKey = new Map<string, GroupBucket>();
  const groupsByTitleKey = new Map<string, GroupBucket>();
  const groupMaps = [groupsByStoryKey, groupsByCanonicalKey, groupsByTitleKey];

  (Array.isArray(newsItems) ? newsItems : [])
    .filter((item) => item?.title)
    .forEach((item) => {
      const storyKey = getStoryGroupKey(item);
      const canonicalKey = getCanonicalGroupKey(item);
      const titleKey = getTitleGroupKey(item);
      const groupCandidates: GroupBucket[] = [];

      addGroupCandidate(groupCandidates, storyKey ? groupsByStoryKey.get(storyKey) : null);
      addGroupCandidate(groupCandidates, canonicalKey ? groupsByCanonicalKey.get(canonicalKey) : null);

      if (titleKey) {
        const titleCandidate = groupsByTitleKey.get(titleKey);
        if (canGroupByTitle(item, titleCandidate)) {
          addGroupCandidate(groupCandidates, titleCandidate);
        }
      }

      let group = groupCandidates[0] || null;

      if (!group) {
        group = {
          ownerKey: getGroupOwnerKey(item),
          latestTimestamp: getArticleTimestamp(item),
          items: []
        };
        groups.push(group);
      } else {
        groupCandidates.slice(1).forEach((candidate) => {
          mergeGroupIntoTarget(groups, groupMaps, group, candidate);
        });
      }

      group.items.push(item);
      group.latestTimestamp = Math.max(group.latestTimestamp || 0, getArticleTimestamp(item));

      if (storyKey) {
        groupsByStoryKey.set(storyKey, group);
      }

      if (canonicalKey) {
        groupsByCanonicalKey.set(canonicalKey, group);
      }

      if (titleKey) {
        groupsByTitleKey.set(titleKey, group);
      }
    });

  return sortGroupsByPubDate(groups
    .map((group) => createGroupFromItems(group.items))
    .filter((group): group is NewsGroup => group !== null));
}

function getArticleQualityScore(article: Partial<Article> = {}) {
  return String(article.content || '').length
    + String(article.description || '').length
    + (article.image ? 120 : 0)
    + (article.author ? 20 : 0);
}

function shouldPreferIncomingArticle(candidate: Article, current: Article | null | undefined) {
  if (!current) {
    return true;
  }

  const candidateScore = getArticleQualityScore(candidate);
  const currentScore = getArticleQualityScore(current);
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore;
  }

  const candidateTimestamp = Date.parse(candidate?.pubDate || '');
  const currentTimestamp = Date.parse(current?.pubDate || '');
  if (!Number.isNaN(candidateTimestamp) || !Number.isNaN(currentTimestamp)) {
    return (candidateTimestamp || 0) >= (currentTimestamp || 0);
  }

  return String(candidate?.id || '') > String(current?.id || '');
}

function buildIncomingArticleDeduplicationKey(article: Article) {
  if (article.canonicalUrl) {
    return [article.ownerUserId || '', article.sourceId || article.rawSourceId || '', article.canonicalUrl].join('|');
  }

  return article.id;
}

function normalizeIncomingArticles(articles: Article[] = []): Article[] {
  const dedupedArticles = new Map<string, Article>();

  articles.forEach((article) => {
    const baseTopics = topicNormalizer.extractTopics(article, article.rawTopics);
    const topicDetails = topicNormalizer.extractTopicDetails(article, article.rawTopics);
    const canonicalSourceId = getCanonicalSourceId(article.sourceId, article.source);
    const canonicalSourceName = getCanonicalSourceName(article.sourceId, article.source);
    const normalizedArticle = {
      ...article,
      rawSourceId: article.sourceId,
      rawSource: article.source,
      canonicalUrl: normalizeArticleUrl(article.canonicalUrl || article.url || ''),
      sourceId: canonicalSourceId,
      source: canonicalSourceName,
      subSource: getSourceVariantLabel(article.sourceId, article.source),
      topics: baseTopics,
      topicDetails
    } as Article;
    const dedupeKey = buildIncomingArticleDeduplicationKey(normalizedArticle);
    const existingArticle = dedupedArticles.get(dedupeKey);

    if (shouldPreferIncomingArticle(normalizedArticle, existingArticle)) {
      dedupedArticles.set(dedupeKey, normalizedArticle);
    }
  });

  return [...dedupedArticles.values()];
}

function buildInsertedGroupsByOwner(normalizedArticles: Article[] = [], insertedIds: string[] = []) {
  const insertedIdSet = new Set(insertedIds);
  const insertedArticles = normalizedArticles.filter((article) => insertedIdSet.has(article.id));
  const globalArticles = insertedArticles.filter((article) => !article.ownerUserId);
  const privateGroupsByUserId = new Map<string, Article[]>();

  insertedArticles
    .filter((article) => article.ownerUserId)
    .forEach((article) => {
      const userId = article.ownerUserId;
      if (!userId) {
        return;
      }
      const current = privateGroupsByUserId.get(userId) || [];
      current.push(article);
      privateGroupsByUserId.set(userId, current);
    });

  return {
    globalGroups: groupSimilarNews(globalArticles),
    privateGroupsByUserId: new Map(
      [...privateGroupsByUserId.entries()].map(([userId, articles]) => [userId, groupSimilarNews(articles)])
    )
  };
}

export = {
  TITLE_GROUP_WINDOW_MS,
  groupSimilarNews,
  normalizeIncomingArticles,
  buildInsertedGroupsByOwner
};
