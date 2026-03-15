const rssParser = require('./rssParser');
const database = require('./database');
const logger = require('../utils/logger');
const websocketService = require('./websocketService');
const { createError } = require('../utils/errorHandler');
const {
  normalizeIncomingArticles,
  buildInsertedGroupsByOwner
} = require('./newsAggregatorGrouping');

const ARTICLE_RETENTION_HOURS = parseInt(process.env.ARTICLE_RETENTION_HOURS || '24', 10);

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

function persistNormalizedArticles(normalizedArticles = []) {
  const upsertResult = database.upsertArticles(normalizedArticles);
  database.mergeTopicsForArticles(normalizedArticles.map((article) => ({
    articleId: article.id,
    topics: article.topics
  })));
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

    const results = await Promise.allSettled(sourceConfigs.map((source) => rssParser.parseFeed(source)));
    const fetchedArticles = results
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => result.value);
    const normalizedArticles = normalizeIncomingArticles(fetchedArticles);

    if (failWhenEmpty && normalizedArticles.length === 0 && database.countArticles() === 0) {
      throw createError(503, 'Impossibile connettersi ai feed di notizie. Riprova più tardi.', 'CONNECTION_ERROR');
    }

    const upsertResult = persistNormalizedArticles(normalizedArticles);
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
  ingestSourceConfigs
};
