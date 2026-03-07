const crypto = require('crypto');
const rssParser = require('./rssParser');
const database = require('./database');
const logger = require('../utils/logger');
const topicNormalizer = require('./topicNormalizer');
const websocketService = require('./websocketService');
const asyncProcessor = require('./asyncProcessor');
const { createError } = require('../utils/errorHandler');
const newsSources = require('../config/newsSources');

const SCRAPE_INTERVAL_MS = parseInt(process.env.SCRAPE_INTERVAL_MS || '300000', 10);
const MAX_SCAN_ARTICLES = parseInt(process.env.MAX_SCAN_ARTICLES || '600', 10);

let refreshPromise = null;
let lastRefreshAt = null;
let schedulerHandle = null;

function expandConfiguredSources() {
  return newsSources.flatMap((source) => {
    if (source.type === 'multi-rss' && Array.isArray(source.urls)) {
      return source.urls.map((url) => ({
        ...source,
        type: 'rss',
        url,
        subId: `${source.id}-${url.split('/').pop().replace('.xml', '').replace(/[^a-z0-9-]/gi, '')}`
      }));
    }

    return [source];
  });
}

function simplifyText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

  const titleA = simplifyText(itemA.title);
  const titleB = simplifyText(itemB.title);
  const bodyA = simplifyText(`${itemA.title} ${itemA.description || ''}`);
  const bodyB = simplifyText(`${itemB.title} ${itemB.description || ''}`);
  const titleSetA = new Set(titleA.split(' ').filter(Boolean));
  const titleSetB = new Set(titleB.split(' ').filter(Boolean));
  const bodySetA = new Set(bodyA.split(' ').filter(Boolean));
  const bodySetB = new Set(bodyB.split(' ').filter(Boolean));

  const titleIntersection = [...titleSetA].filter((word) => titleSetB.has(word)).length;
  const bodyIntersection = [...bodySetA].filter((word) => bodySetB.has(word)).length;
  const titleUnion = titleSetA.size + titleSetB.size - titleIntersection;
  const bodyUnion = bodySetA.size + bodySetB.size - bodyIntersection;

  const titleScore = titleUnion > 0 ? titleIntersection / titleUnion : 0;
  const bodyScore = bodyUnion > 0 ? bodyIntersection / bodyUnion : 0;

  const topicSetA = new Set((itemA.topics || []).map((topic) => topic.toLowerCase()));
  const topicSetB = new Set((itemB.topics || []).map((topic) => topic.toLowerCase()));
  const topicIntersection = [...topicSetA].filter((topic) => topicSetB.has(topic)).length;
  const topicScore = topicSetA.size > 0 && topicSetB.size > 0
    ? topicIntersection / Math.max(topicSetA.size, topicSetB.size)
    : 0;

  return (0.6 * titleScore) + (0.25 * bodyScore) + (0.15 * topicScore);
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
      const score = calculateSimilarity(group.items[0], item);
      if (score > 0.45 && score > bestScore) {
        bestGroup = group;
        bestScore = score;
      }
    });

    if (!bestGroup) {
      groups.push({
        id: buildStableGroupId([item]),
        items: [item],
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
    const normalizedArticle = {
      ...article,
      topics: baseTopics
    };
    dedupedArticles.set(article.id, normalizedArticle);
  });

  return [...dedupedArticles.values()];
}

async function ingestAllNews(options = {}) {
  const broadcast = options.broadcast !== false;

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const ingestionRun = database.createIngestionRun();

    try {
      const sourceConfigs = expandConfiguredSources();
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
        asyncProcessor.enqueueArticle(article);
      });

      const insertedArticles = database.getArticlesByIds(upsertResult.insertedIds);
      const insertedGroups = groupSimilarNews(insertedArticles);

      if (broadcast && insertedGroups.length > 0) {
        websocketService.broadcastNewsUpdate(insertedGroups);
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
  if (database.countArticles() > 0) {
    return;
  }

  await ingestAllNews({ force: true, broadcast: false });
}

async function getNewsFeed(filters = {}) {
  await ensureSeedData();

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
    });

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
      sources: database.getSourceStats(newsSources),
      topics: database.getTopicStats(18)
    }
  };
}

async function searchNews(query, filters = {}) {
  if (!query || String(query).trim().length < 2) {
    throw createError(400, 'Il termine di ricerca deve contenere almeno 2 caratteri', 'INVALID_SEARCH_QUERY');
  }

  return getNewsFeed({ ...filters, search: query });
}

async function getHotTopics(limit = 12) {
  await ensureSeedData();
  return database.getTopicStats(limit);
}

function getSources() {
  return database.getSourceStats(newsSources);
}

function getArticleTopics(articleId) {
  return database.getTopicsForArticle(articleId);
}

async function forceRefresh() {
  const result = await ingestAllNews({ force: true, broadcast: true });
  websocketService.broadcastSystemNotification('Dati aggiornati con successo', 'info');
  return result;
}

function startScheduler() {
  if (schedulerHandle) {
    return;
  }

  ingestAllNews({ force: true, broadcast: false }).catch((error) => {
    logger.warn(`Initial ingestion failed: ${error.message}`);
  });

  schedulerHandle = setInterval(() => {
    ingestAllNews({ force: true, broadcast: true }).catch((error) => {
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
  searchNews,
  getHotTopics,
  getSources,
  getArticleTopics,
  forceRefresh,
  startScheduler,
  stopScheduler,
  newsSources,
  _groupSimilarNews: groupSimilarNews,
  _buildStableGroupId: buildStableGroupId
};
