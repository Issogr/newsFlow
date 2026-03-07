const crypto = require('crypto');
const rssParser = require('./rssParser');
const database = require('./database');
const logger = require('../utils/logger');
const topicNormalizer = require('./topicNormalizer');
const websocketService = require('./websocketService');
const { createError } = require('../utils/errorHandler');
const newsSources = require('../config/newsSources');
const {
  getCanonicalSourceId,
  getCanonicalSourceName,
  getConfiguredSourceGroups,
  getSourceVariantLabel
} = require('../utils/sourceCatalog');

const SCRAPE_INTERVAL_MS = parseInt(process.env.SCRAPE_INTERVAL_MS || '300000', 10);
const MAX_SCAN_ARTICLES = parseInt(process.env.MAX_SCAN_ARTICLES || '600', 10);
const ARTICLE_RETENTION_HOURS = parseInt(process.env.ARTICLE_RETENTION_HOURS || '24', 10);

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

let refreshPromise = null;
let lastRefreshAt = null;
let schedulerHandle = null;

function purgeExpiredArticles() {
  if (!Number.isFinite(ARTICLE_RETENTION_HOURS) || ARTICLE_RETENTION_HOURS <= 0) {
    return 0;
  }

  const cutoff = new Date(Date.now() - (ARTICLE_RETENTION_HOURS * 60 * 60 * 1000)).toISOString();
  const removedCount = database.deleteArticlesOlderThan(cutoff);

  if (removedCount > 0) {
    logger.info(`Purged ${removedCount} articles older than ${ARTICLE_RETENTION_HOURS} hours`);
  }

  return removedCount;
}

function cleanupRemovedConfiguredSourceData() {
  const result = database.cleanupRemovedConfiguredSourceData();

  if (result.removedArticles > 0 || result.updatedSettings > 0) {
    logger.info(`Removed ${result.removedArticles} articles and updated ${result.updatedSettings} user settings for deleted default sources`);
  }

  return result;
}

function expandConfiguredSources() {
  return newsSources;
}

function expandUserSources(userSources = []) {
  return userSources
    .filter((source) => source?.isActive !== false)
    .map((source) => ({
      id: source.id,
      name: source.name,
      url: source.url,
      type: 'rss',
      language: source.language || 'it',
      ownerUserId: source.userId
    }));
}

function getAvailableSources(userContext = {}) {
  const userSources = userContext.userId ? database.listUserSources(userContext.userId) : [];
  return [
    ...getConfiguredSourceGroups(),
    ...userSources.map((source) => ({
      id: source.id,
      name: source.name,
      language: source.language,
      type: 'rss',
      url: source.url
    }))
  ];
}

function getQueryOptions(userContext = {}) {
  return {
    userId: userContext.userId || null,
    maxArticleAgeHours: Math.min(
      ARTICLE_RETENTION_HOURS,
      Number.isFinite(userContext.articleRetentionHours) ? userContext.articleRetentionHours : ARTICLE_RETENTION_HOURS
    ),
    excludedSourceIds: Array.isArray(userContext.excludedSourceIds) ? userContext.excludedSourceIds : [],
    excludedSubSourceIds: Array.isArray(userContext.excludedSubSourceIds) ? userContext.excludedSubSourceIds : []
  };
}

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

function groupSimilarNews(newsItems) {
  if (!Array.isArray(newsItems) || newsItems.length === 0) {
    return [];
  }

  const validItems = newsItems.filter((item) => item?.title);
  const groups = [];

  validItems.forEach((item) => {
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
      return;
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
  });

  return groups.sort((left, right) => new Date(right.pubDate) - new Date(left.pubDate));
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

async function ingestAllNews(options = {}) {
  const broadcast = options.broadcast !== false;

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const ingestionRun = database.createIngestionRun();

    try {
      purgeExpiredArticles();
      cleanupRemovedConfiguredSourceData();

      const sourceConfigs = [
        ...expandConfiguredSources(),
        ...expandUserSources(database.listAllActiveUserSources())
      ];
      const results = await Promise.allSettled(sourceConfigs.map((source) => rssParser.parseFeed(source)));
      const fetchedArticles = results
        .filter((result) => result.status === 'fulfilled')
        .flatMap((result) => result.value);
      const normalizedArticles = normalizeIncomingArticles(fetchedArticles);

      if (normalizedArticles.length === 0 && database.countArticles() === 0) {
        throw createError(503, 'Impossibile connettersi ai feed di notizie. Riprova più tardi.', 'CONNECTION_ERROR');
      }

      const upsertResult = database.upsertArticles(normalizedArticles);
      normalizedArticles.forEach((article) => {
        database.mergeTopicsForArticle(article.id, article.topics);
      });

      const insertedGroups = buildInsertedGroupsByOwner(normalizedArticles, upsertResult.insertedIds);

      if (broadcast) {
        if (insertedGroups.globalGroups.length > 0) {
          websocketService.broadcastNewsUpdate(insertedGroups.globalGroups);
        }

        insertedGroups.privateGroupsByUserId.forEach((groups, userId) => {
          if (groups.length > 0) {
            websocketService.broadcastNewsUpdate(groups.map((group) => ({ ...group, ownerUserId: userId })));
          }
        });
      }

      lastRefreshAt = new Date().toISOString();
      const payload = {
        success: true,
        fetchedCount: normalizedArticles.length,
        insertedCount: upsertResult.insertedCount,
        updatedCount: upsertResult.updatedCount,
        lastRefreshAt
      };

      database.completeIngestionRun(ingestionRun.id, {
        status: 'completed',
        fetchedCount: payload.fetchedCount,
        insertedCount: payload.insertedCount,
        updatedCount: payload.updatedCount
      });

      logger.info(`Ingestion completed: ${payload.fetchedCount} fetched, ${payload.insertedCount} inserted, ${payload.updatedCount} updated`);
      return payload;
    } catch (error) {
      database.completeIngestionRun(ingestionRun.id, {
        status: 'failed',
        errorMessage: error.message
      });

      logger.error(`News ingestion failed: ${error.message}`);
      throw error.status ? error : createError(500, 'Errore durante l\'aggiornamento delle notizie.', 'SERVER_ERROR', error);
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function ensureSeedData() {
  purgeExpiredArticles();

  if (database.countArticles() > 0) {
    return;
  }

  await ingestAllNews({ broadcast: false });
}

async function getNewsFeed(filters = {}, userContext = {}) {
  await ensureSeedData();

  const queryOptions = getQueryOptions(userContext);
  const availableSources = getAvailableSources(userContext);

  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.max(1, Math.min(Number(filters.pageSize) || 12, 30));
  const targetGroups = (page * pageSize) + 1;
  const batchSize = Math.max(pageSize * 4, 40);

  let articleOffset = 0;
  let exhausted = false;
  let collectedArticles = [];
  let groupedResults = [];

  while (!exhausted && articleOffset < MAX_SCAN_ARTICLES && groupedResults.length < targetGroups) {
    const batch = database.getArticles({
      search: filters.search,
      sourceIds: filters.sourceIds,
      topics: filters.topics,
      recentHours: filters.recentHours,
      limit: batchSize,
      offset: articleOffset
    }, queryOptions);

    if (batch.length === 0) {
      exhausted = true;
      break;
    }

    collectedArticles = [...collectedArticles, ...batch];
    groupedResults = groupSimilarNews(collectedArticles);
    articleOffset += batch.length;

    if (batch.length < batchSize) {
      exhausted = true;
    }
  }

  const startIndex = (page - 1) * pageSize;
  const pagedItems = groupedResults.slice(startIndex, startIndex + pageSize);
  const latestIngestion = database.getLatestIngestionRun();

  return {
    items: pagedItems,
    meta: {
      page,
      pageSize,
      hasMore: groupedResults.length > (startIndex + pageSize) || !exhausted,
      totalGroups: exhausted ? groupedResults.length : null,
      scannedArticles: collectedArticles.length,
      lastRefreshAt,
      ingestion: latestIngestion
    },
    filters: {
      sources: database.getSourceStats(availableSources, queryOptions),
      sourceCatalog: availableSources.map((source) => ({
        id: source.id,
        name: source.name,
        language: source.language || null,
        subSources: Array.isArray(source.subSources) ? source.subSources : []
      })),
      topics: database.getTopicStatsByFilters({
        search: filters.search,
        sourceIds: filters.sourceIds,
        recentHours: filters.recentHours
      }, 18, queryOptions)
    }
  };
}

async function forceRefresh() {
  const result = await ingestAllNews({ broadcast: true });
  websocketService.broadcastSystemNotification('Dati aggiornati con successo', 'info');
  return result;
}

function startScheduler() {
  if (schedulerHandle) {
    return;
  }

  ingestAllNews({ broadcast: false }).catch((error) => {
    logger.warn(`Initial ingestion failed: ${error.message}`);
  });

  schedulerHandle = setInterval(() => {
    ingestAllNews({ broadcast: true }).catch((error) => {
      logger.warn(`Scheduled ingestion failed: ${error.message}`);
    });
  }, SCRAPE_INTERVAL_MS);
}

function stopScheduler() {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
}

process.on('exit', stopScheduler);

module.exports = {
  ingestAllNews,
  getNewsFeed,
  forceRefresh,
  startScheduler,
  stopScheduler,
  newsSources,
  _groupSimilarNews: groupSimilarNews,
  _buildStableGroupId: buildStableGroupId,
  _calculateSimilarity: calculateSimilarity
};
