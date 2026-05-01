const crypto = require('crypto');
const topicNormalizer = require('./topicNormalizer');
const {
  getCanonicalSourceId,
  getCanonicalSourceName,
  getSourceVariantLabel
} = require('../utils/sourceCatalog');
const { normalizeArticleUrl } = require('../utils/articleIdentity');

const TITLE_GROUP_WINDOW_MS = 12 * 60 * 60 * 1000;
const TITLE_STOP_WORDS = new Set([
  'a', 'ad', 'al', 'alla', 'and', 'con', 'da', 'dal', 'dalla', 'de', 'del', 'della', 'di', 'e', 'for', 'from', 'il', 'in', 'la', 'le', 'lo', 'of', 'on', 'per', 'the', 'to', 'un', 'una', 'with'
]);

function getStableArticleKey(item) {
  if (!item || typeof item !== 'object') {
    return '';
  }

  return item.id || item.url || item.title || '';
}

function buildStableGroupId(items) {
  const stableKeys = (Array.isArray(items) ? items : [])
    .map(getStableArticleKey)
    .filter(Boolean)
    .sort();

  if (stableKeys.length === 0) {
    return `group-${Date.now()}`;
  }

  return `group-${crypto.createHash('sha1').update(stableKeys.join('|')).digest('hex').slice(0, 16)}`;
}

function sortGroupsByPubDate(groups = []) {
  return groups.sort((left, right) => new Date(right.pubDate) - new Date(left.pubDate));
}

function createStandaloneGroup(item) {
  return {
    id: buildStableGroupId([item]),
    items: [item],
    ownerUserId: item.ownerUserId || null,
    sources: [item.source],
    title: item.title,
    description: item.description,
    pubDate: item.pubDate,
    topics: [...(item.topics || [])],
    topicDetails: [...(item.topicDetails || [])],
    url: item.url
  };
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

function getArticleTimestamp(item = {}) {
  const parsed = Date.parse(item.pubDate || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function getGroupOwnerKey(item = {}) {
  return item.ownerUserId || '';
}

function getCanonicalGroupKey(item = {}) {
  const canonicalUrl = normalizeArticleUrl(item.canonicalUrl || item.url || '');
  return canonicalUrl ? `url:${getGroupOwnerKey(item)}:${canonicalUrl}` : '';
}

function getTitleGroupKey(item = {}) {
  const titleKey = normalizeTitleKey(item.title);
  return titleKey ? `title:${getGroupOwnerKey(item)}:${titleKey}` : '';
}

function canGroupByTitle(item, group) {
  if (!group || getGroupOwnerKey(item) !== group.ownerKey) {
    return false;
  }

  const itemTimestamp = getArticleTimestamp(item);
  if (!itemTimestamp || !group.latestTimestamp) {
    return false;
  }

  return Math.abs(group.latestTimestamp - itemTimestamp) <= TITLE_GROUP_WINDOW_MS;
}

function addUniqueTopicDetails(topicMap, entries = []) {
  entries.forEach((entry) => {
    const topic = String(entry?.topic || entry || '').trim();
    if (!topic) {
      return;
    }

    const key = topic.toLowerCase();
    const current = topicMap.get(key);
    const nextEntry = entry && typeof entry === 'object' ? { ...entry, topic } : { topic };

    if (!current || nextEntry.source === 'ai') {
      topicMap.set(key, nextEntry);
    }
  });
}

function createGroupFromItems(items = []) {
  const sortedItems = [...items].sort((left, right) => getArticleTimestamp(right) - getArticleTimestamp(left));
  const primaryItem = sortedItems[0];

  if (!primaryItem) {
    return null;
  }

  const sourceNames = new Set();
  const topicMap = new Map();

  sortedItems.forEach((item) => {
    if (item.source) {
      sourceNames.add(item.source);
    }

    addUniqueTopicDetails(topicMap, item.topicDetails || []);
    addUniqueTopicDetails(topicMap, item.topics || []);
  });

  const topicDetails = [...topicMap.values()];

  return {
    id: buildStableGroupId(sortedItems),
    items: sortedItems,
    ownerUserId: primaryItem.ownerUserId || null,
    sources: [...sourceNames],
    title: primaryItem.title,
    description: primaryItem.description,
    pubDate: primaryItem.pubDate,
    topics: topicDetails.map((entry) => entry.topic),
    topicDetails,
    url: primaryItem.url
  };
}

function groupSimilarNews(newsItems) {
  const groups = [];
  const groupsByCanonicalKey = new Map();
  const groupsByTitleKey = new Map();

  (Array.isArray(newsItems) ? newsItems : [])
    .filter((item) => item?.title)
    .forEach((item) => {
      const canonicalKey = getCanonicalGroupKey(item);
      const titleKey = getTitleGroupKey(item);
      let group = canonicalKey ? groupsByCanonicalKey.get(canonicalKey) : null;

      if (!group && titleKey) {
        const titleCandidate = groupsByTitleKey.get(titleKey);
        if (canGroupByTitle(item, titleCandidate)) {
          group = titleCandidate;
        }
      }

      if (!group) {
        group = {
          ownerKey: getGroupOwnerKey(item),
          latestTimestamp: getArticleTimestamp(item),
          items: []
        };
        groups.push(group);
      }

      group.items.push(item);
      group.latestTimestamp = Math.max(group.latestTimestamp || 0, getArticleTimestamp(item));

      if (canonicalKey) {
        groupsByCanonicalKey.set(canonicalKey, group);
      }

      if (titleKey) {
        groupsByTitleKey.set(titleKey, group);
      }
    });

  return sortGroupsByPubDate(groups.map((group) => createGroupFromItems(group.items)).filter(Boolean));
}

function getArticleQualityScore(article = {}) {
  return String(article.content || '').length
    + String(article.description || '').length
    + (article.image ? 120 : 0)
    + (article.author ? 20 : 0);
}

function shouldPreferIncomingArticle(candidate, current) {
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

function buildIncomingArticleDeduplicationKey(article = {}) {
  if (article.canonicalUrl) {
    return [article.ownerUserId || '', article.sourceId || article.rawSourceId || '', article.canonicalUrl].join('|');
  }

  return article.id;
}

function normalizeIncomingArticles(articles = []) {
  const dedupedArticles = new Map();

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
    };
    const dedupeKey = buildIncomingArticleDeduplicationKey(normalizedArticle);
    const existingArticle = dedupedArticles.get(dedupeKey);

    if (shouldPreferIncomingArticle(normalizedArticle, existingArticle)) {
      dedupedArticles.set(dedupeKey, normalizedArticle);
    }
  });

  return [...dedupedArticles.values()];
}

function buildInsertedGroupsByOwner(normalizedArticles = [], insertedIds = []) {
  const insertedIdSet = new Set(insertedIds);
  const insertedArticles = normalizedArticles.filter((article) => insertedIdSet.has(article.id));
  const globalArticles = insertedArticles.filter((article) => !article.ownerUserId);
  const privateGroupsByUserId = new Map();

  insertedArticles
    .filter((article) => article.ownerUserId)
    .forEach((article) => {
      const current = privateGroupsByUserId.get(article.ownerUserId) || [];
      current.push(article);
      privateGroupsByUserId.set(article.ownerUserId, current);
    });

  return {
    globalGroups: groupSimilarNews(globalArticles),
    privateGroupsByUserId: new Map(
      [...privateGroupsByUserId.entries()].map(([userId, articles]) => [userId, groupSimilarNews(articles)])
    )
  };
}

module.exports = {
  buildStableGroupId,
  sortGroupsByPubDate,
  createStandaloneGroup,
  groupSimilarNews,
  normalizeIncomingArticles,
  buildInsertedGroupsByOwner
};
