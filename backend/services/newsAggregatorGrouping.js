const crypto = require('crypto');
const topicNormalizer = require('./topicNormalizer');
const {
  getCanonicalSourceId,
  getCanonicalSourceName,
  getSourceVariantLabel
} = require('../utils/sourceCatalog');

const TITLE_STOP_WORDS = new Set([
  'a', 'ad', 'agli', 'ai', 'al', 'alla', 'alle', 'allo', 'anche', 'che', 'con', 'da', 'dal', 'dalla', 'dalle', 'dei', 'del', 'della',
  'delle', 'di', 'e', 'ed', 'for', 'gli', 'i', 'il', 'in', 'la', 'le', 'lo', 'nel', 'nella', 'nelle', 'o', 'per', 'piu', 'su', 'sul',
  'sulla', 'the', 'tra', 'un', 'una'
]);

const ENTITY_STOP_WORDS = new Set([
  'ansa', 'bbc', 'breaking', 'home', 'il', 'la', 'le', 'live', 'mondo', 'news', 'politica', 'sole', 'ultima', 'ultim ora', 'world'
]);

const TITLE_PREFIX_PATTERNS = [
  /^aggiornamento\s*[:\-]\s*/i,
  /^breaking\s*[:\-]\s*/i,
  /^diretta\s*[:\-]\s*/i,
  /^live\s*[:\-]\s*/i,
  /^ultima ora\s*[:\-]\s*/i,
  /^ultim ora\s*[:\-]\s*/i
];

const simHashProfileCache = new WeakMap();

function simplifyText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitleForMatching(title) {
  let normalizedTitle = String(title || '').trim();

  TITLE_PREFIX_PATTERNS.forEach((pattern) => {
    normalizedTitle = normalizedTitle.replace(pattern, '');
  });

  const simplifiedTitle = simplifyText(normalizedTitle);
  if (!simplifiedTitle) {
    return '';
  }

  return simplifiedTitle
    .split(' ')
    .filter((token) => token.length > 2 && !TITLE_STOP_WORDS.has(token))
    .join(' ')
    .trim();
}

function toTokenSet(text) {
  return new Set(String(text || '').split(' ').filter((token) => token.length > 1));
}

function extractNamedEntities(item = {}) {
  const text = [item.title, item.description]
    .filter(Boolean)
    .join(' ');

  if (!text) {
    return new Set();
  }

  const matches = text.match(/\b(?:[A-Z][\p{L}\p{M}'-]+|[A-Z]{2,})(?:\s+(?:[A-Z][\p{L}\p{M}'-]+|[A-Z]{2,})){0,2}\b/gu) || [];

  return new Set(
    matches
      .map((match) => simplifyText(match))
      .filter((entity) => entity.length > 2 && !ENTITY_STOP_WORDS.has(entity))
  );
}

function getWeightedFeatureMap(item = {}) {
  const featureWeights = new Map();

  const addFeatures = (values, weight) => {
    values.forEach((value) => {
      const normalizedValue = String(value || '').trim();
      if (!normalizedValue) {
        return;
      }

      featureWeights.set(normalizedValue, (featureWeights.get(normalizedValue) || 0) + weight);
    });
  };

  const normalizedTitle = normalizeTitleForMatching(item.title);
  const titleTokens = [...toTokenSet(normalizedTitle)];
  const topicTokens = (item.topics || []).map((topic) => simplifyText(topic)).filter(Boolean);
  const entityTokens = [...extractNamedEntities(item)];

  addFeatures(titleTokens, 6);
  addFeatures(topicTokens, 4);
  addFeatures(entityTokens, 4);

  return {
    normalizedTitle,
    titleTokens: new Set(titleTokens),
    topicTokens: new Set(topicTokens),
    entityTokens: new Set(entityTokens),
    featureWeights
  };
}

function buildSimHash(featureWeights = new Map()) {
  const vector = Array(64).fill(0);

  featureWeights.forEach((weight, feature) => {
    const hash = BigInt(`0x${crypto.createHash('sha1').update(feature).digest('hex').slice(0, 16)}`);

    for (let index = 0; index < 64; index += 1) {
      const bitmask = 1n << BigInt(index);
      vector[index] += (hash & bitmask) ? weight : -weight;
    }
  });

  return vector.reduce((fingerprint, score, index) => {
    if (score >= 0) {
      return fingerprint | (1n << BigInt(index));
    }

    return fingerprint;
  }, 0n);
}

function calculateHammingDistance(leftFingerprint, rightFingerprint) {
  let value = BigInt(leftFingerprint) ^ BigInt(rightFingerprint);
  let distance = 0;

  while (value > 0n) {
    distance += Number(value & 1n);
    value >>= 1n;
  }

  return distance;
}

function getSimHashProfile(item = {}) {
  if (simHashProfileCache.has(item)) {
    return simHashProfileCache.get(item);
  }

  const featureProfile = getWeightedFeatureMap(item);
  const profile = {
    ...featureProfile,
    fingerprint: buildSimHash(featureProfile.featureWeights)
  };

  simHashProfileCache.set(item, profile);
  return profile;
}

function calculateSetScore(valuesA = [], valuesB = []) {
  const setA = valuesA instanceof Set ? valuesA : new Set(valuesA);
  const setB = valuesB instanceof Set ? valuesB : new Set(valuesB);

  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }

  const intersection = [...setA].filter((value) => setB.has(value)).length;
  const union = setA.size + setB.size - intersection;

  return union > 0 ? intersection / union : 0;
}

function calculateTimeProximityScore(itemA, itemB) {
  const timestampA = Date.parse(itemA?.pubDate || '');
  const timestampB = Date.parse(itemB?.pubDate || '');

  if (!Number.isFinite(timestampA) || !Number.isFinite(timestampB)) {
    return 0;
  }

  const hoursDifference = Math.abs(timestampA - timestampB) / (1000 * 60 * 60);

  if (hoursDifference <= 2) {
    return 1;
  }

  if (hoursDifference <= 6) {
    return 0.8;
  }

  if (hoursDifference <= 12) {
    return 0.55;
  }

  if (hoursDifference <= 24) {
    return 0.3;
  }

  return 0;
}

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

function calculateSimilarity(itemA, itemB) {
  if (!itemA?.title || !itemB?.title) {
    return 0;
  }

  if (itemA.title === itemB.title) {
    return 1;
  }

  const profileA = getSimHashProfile(itemA);
  const profileB = getSimHashProfile(itemB);

  const titleScore = calculateSetScore(profileA.titleTokens, profileB.titleTokens);
  const topicScore = calculateSetScore(profileA.topicTokens, profileB.topicTokens);
  const entityScore = calculateSetScore(profileA.entityTokens, profileB.entityTokens);
  const timeScore = calculateTimeProximityScore(itemA, itemB);
  const simHashScore = 1 - (calculateHammingDistance(profileA.fingerprint, profileB.fingerprint) / 64);
  const strongTitleMatch = profileA.normalizedTitle && profileB.normalizedTitle && (
    profileA.normalizedTitle === profileB.normalizedTitle
    || (profileA.normalizedTitle.length >= 18
      && profileB.normalizedTitle.length >= 18
      && (
        profileA.normalizedTitle.includes(profileB.normalizedTitle)
        || profileB.normalizedTitle.includes(profileA.normalizedTitle)
      ))
  );

  if (strongTitleMatch && (entityScore > 0 || timeScore >= 0.55 || topicScore >= 0.5 || simHashScore >= 0.82)) {
    return Math.min(1, 0.78 + (0.12 * entityScore) + (0.1 * Math.max(timeScore, topicScore)));
  }

  if (titleScore < 0.22 && entityScore === 0 && topicScore < 0.5) {
    return 0;
  }

  if (simHashScore < 0.66 && titleScore < 0.28 && entityScore === 0) {
    return 0;
  }

  if (simHashScore < 0.62 && titleScore < 0.18 && entityScore === 0 && topicScore === 0) {
    return 0;
  }

  return (0.62 * simHashScore)
    + (0.14 * titleScore)
    + (0.1 * topicScore)
    + (0.08 * entityScore)
    + (0.06 * timeScore);
}

function insertArticleIntoGroups(groups, item) {
  if (!item?.title) {
    return groups;
  }

  let bestGroup = null;
  let bestScore = 0;

  groups.forEach((group) => {
    const score = group.items.reduce((highestScore, groupedItem) => {
      return Math.max(highestScore, calculateSimilarity(groupedItem, item));
    }, 0);

    if (score > 0.58 && score > bestScore) {
      bestGroup = group;
      bestScore = score;
    }
  });

  if (!bestGroup) {
    groups.push({
      id: buildStableGroupId([item]),
      items: [item],
      ownerUserId: item.ownerUserId || null,
      sources: [item.source],
      title: item.title,
      description: item.description,
      pubDate: item.pubDate,
      topics: [...(item.topics || [])],
      url: item.url
    });
    return groups;
  }

  bestGroup.items.push(item);
  bestGroup.sources = [...new Set([...bestGroup.sources, item.source])];
  bestGroup.topics = topicNormalizer.limitTopics([...bestGroup.topics, ...(item.topics || [])], 4);
  bestGroup.ownerUserId = bestGroup.ownerUserId || item.ownerUserId || null;
  if (new Date(item.pubDate) > new Date(bestGroup.pubDate)) {
    bestGroup.pubDate = item.pubDate;
    bestGroup.title = item.title;
    bestGroup.description = item.description;
    bestGroup.url = item.url;
  }

  bestGroup.id = buildStableGroupId(bestGroup.items);
  return groups;
}

function groupSimilarNews(newsItems) {
  if (!Array.isArray(newsItems) || newsItems.length === 0) {
    return [];
  }

  const groups = [];
  newsItems.forEach((item) => {
    insertArticleIntoGroups(groups, item);
  });

  return sortGroupsByPubDate(groups);
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
      sourceId: canonicalSourceId,
      source: canonicalSourceName,
      subSource: getSourceVariantLabel(article.sourceId, article.source),
      topics: baseTopics
    };
    dedupedArticles.set(article.id, normalizedArticle);
  });

  return [...dedupedArticles.values()];
}

function buildInsertedGroupsByOwner(normalizedArticles = [], insertedIds = []) {
  const insertedIdSet = new Set(insertedIds);
  const insertedArticles = normalizedArticles.filter((article) => insertedIdSet.has(article.id));
  const globalArticles = insertedArticles.filter((article) => !article.ownerUserId);
  const privateGroupsByUserId = new Map();

  const globalGroups = groupSimilarNews(globalArticles);

  insertedArticles
    .filter((article) => article.ownerUserId)
    .forEach((article) => {
      const current = privateGroupsByUserId.get(article.ownerUserId) || [];
      current.push(article);
      privateGroupsByUserId.set(article.ownerUserId, current);
    });

  return {
    globalGroups,
    privateGroupsByUserId: new Map(
      [...privateGroupsByUserId.entries()].map(([userId, articles]) => [userId, groupSimilarNews(articles)])
    )
  };
}

module.exports = {
  buildStableGroupId,
  sortGroupsByPubDate,
  calculateSimilarity,
  insertArticleIntoGroups,
  groupSimilarNews,
  normalizeIncomingArticles,
  buildInsertedGroupsByOwner
};
