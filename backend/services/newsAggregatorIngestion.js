const rssParser = require('./rssParser');
const database = require('./database');
const logger = require('../utils/logger');
const websocketService = require('./websocketService');
const { classifyTopicsForArticles } = require('./aiTopicClassifier');
const { createError } = require('../utils/errorHandler');
const {
  normalizeIncomingArticles,
  buildInsertedGroupsByOwner
} = require('./newsAggregatorGrouping');

const ARTICLE_RETENTION_HOURS = parseInt(process.env.ARTICLE_RETENTION_HOURS || '24', 10);
const RSS_INGESTION_CONCURRENCY = Math.max(1, parseInt(process.env.RSS_INGESTION_CONCURRENCY || '8', 10) || 8);

async function mapSettledWithConcurrency(items = [], concurrency = RSS_INGESTION_CONCURRENCY, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        results[currentIndex] = {
          status: 'fulfilled',
          value: await mapper(items[currentIndex], currentIndex)
        };
      } catch (reason) {
        results[currentIndex] = {
          status: 'rejected',
          reason
        };
      }
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function purgeExpiredArticles() {
  const normalizedFutureCount = database.normalizeFuturePublicationDates();

  if (normalizedFutureCount > 0) {
    logger.info(`Normalized ${normalizedFutureCount} future-dated articles to the current day`);
  }

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

function createEmptyRefreshPayload(lastRefreshAt = null) {
  return {
    success: true,
    fetchedCount: 0,
    insertedCount: 0,
    updatedCount: 0,
    lastRefreshAt
  };
}

async function applyAiTopicsForInsertedArticles(normalizedArticles = [], insertedIds = []) {
  if (!Array.isArray(normalizedArticles) || normalizedArticles.length === 0 || !Array.isArray(insertedIds) || insertedIds.length === 0) {
    return;
  }

  const insertedIdSet = new Set(insertedIds);
  const insertedArticles = normalizedArticles.filter((article) => insertedIdSet.has(article.id));
  const topicsByArticleId = await classifyTopicsForArticles(insertedArticles);

  topicsByArticleId.forEach((topics, articleId) => {
    const article = insertedArticles.find((item) => item.id === articleId);
    if (article && Array.isArray(topics) && topics.length > 0) {
      article.topics = topics;
    }
  });
}

function mergeNormalizedArticleTopics(normalizedArticles = []) {
  database.mergeTopicsForArticles(normalizedArticles.map((article) => ({
    articleId: article.id,
    topics: article.topics
  })));
}

async function persistNormalizedArticles(normalizedArticles = []) {
  const upsertResult = database.upsertArticles(normalizedArticles);
  await applyAiTopicsForInsertedArticles(normalizedArticles, upsertResult.insertedIds);
  mergeNormalizedArticleTopics(normalizedArticles);
  return upsertResult;
}

function broadcastInsertedGroups(insertedGroups) {
  if (insertedGroups.globalGroups.length > 0) {
    websocketService.broadcastNewsUpdate(insertedGroups.globalGroups);
  }

  insertedGroups.privateGroupsByUserId.forEach((groups, userId) => {
    if (groups.length > 0) {
      websocketService.broadcastNewsUpdate(groups.map((group) => ({ ...group, ownerUserId: userId })));
    }
  });
}

async function ingestSourceConfigs(sourceConfigs = [], options = {}, runtime = {}) {
  const {
    broadcast = true,
    includeMaintenance = false,
    failWhenEmpty = false,
    updateRefreshTimestamp = false,
    trackIngestionRun = false
  } = options;
  const {
    getLastRefreshAt = () => null,
    setLastRefreshAt = () => null
  } = runtime;
  const ingestionRun = trackIngestionRun ? database.createIngestionRun() : null;

  try {
    if (includeMaintenance) {
      purgeExpiredArticles();
      cleanupRemovedConfiguredSourceData();
    }

    const results = await mapSettledWithConcurrency(sourceConfigs, RSS_INGESTION_CONCURRENCY, (source) => rssParser.parseFeed(source));
    const fetchedArticles = results
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => result.value);
    const normalizedArticles = normalizeIncomingArticles(fetchedArticles);

    if (failWhenEmpty && normalizedArticles.length === 0 && database.countArticles() === 0) {
      throw createError(503, 'Unable to connect to news feeds. Please try again later.', 'CONNECTION_ERROR');
    }

    const upsertResult = await persistNormalizedArticles(normalizedArticles);
    const insertedGroups = buildInsertedGroupsByOwner(normalizedArticles, upsertResult.insertedIds);

    if (broadcast) {
      broadcastInsertedGroups(insertedGroups);
    }

    if (updateRefreshTimestamp) {
      setLastRefreshAt(new Date().toISOString());
    }

    const payload = {
      success: true,
      fetchedCount: normalizedArticles.length,
      insertedCount: upsertResult.insertedCount,
      updatedCount: upsertResult.updatedCount,
      lastRefreshAt: getLastRefreshAt()
    };

    if (ingestionRun) {
      database.completeIngestionRun(ingestionRun.id, {
        status: 'completed',
        fetchedCount: payload.fetchedCount,
        insertedCount: payload.insertedCount,
        updatedCount: payload.updatedCount
      });
    }

    return payload;
  } catch (error) {
    if (ingestionRun) {
      database.completeIngestionRun(ingestionRun.id, {
        status: 'failed',
        errorMessage: error.message
      });
    }

    throw error;
  }
}

module.exports = {
  purgeExpiredArticles,
  cleanupRemovedConfiguredSourceData,
  createEmptyRefreshPayload,
  ingestSourceConfigs,
  mapSettledWithConcurrency,
  applyAiTopicsForInsertedArticles
};
