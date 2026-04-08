const crypto = require('crypto');
const topicNormalizer = require('./topicNormalizer');
const {
  getCanonicalSourceId,
  getCanonicalSourceName,
  getSourceVariantLabel
} = require('../utils/sourceCatalog');
const { normalizeArticleUrl } = require('../utils/articleIdentity');

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
    url: item.url
  };
}

function groupSimilarNews(newsItems) {
  return sortGroupsByPubDate(
    (Array.isArray(newsItems) ? newsItems : [])
      .filter((item) => item?.title)
      .map((item) => createStandaloneGroup(item))
  );
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
    return [article.ownerUserId || '', article.rawSourceId || article.sourceId || '', article.canonicalUrl].join('|');
  }

  return article.id;
}

function normalizeIncomingArticles(articles = []) {
  const dedupedArticles = new Map();

  articles.forEach((article) => {
    const baseTopics = topicNormalizer.extractTopics(article, article.rawTopics);
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
      topics: baseTopics
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
