const database = require('./database');
const logger = require('../utils/logger');
const { createError } = require('../utils/errorHandler');
const {
  newsSources,
  expandConfiguredSources,
  expandUserSources,
  getNewsFeed: buildNewsFeed
} = require('./newsAggregatorQuery');
const {
  buildStableGroupId,
  calculateSimilarity,
  groupSimilarNews,
  insertArticleIntoGroups
} = require('./newsAggregatorGrouping');
const {
  purgeExpiredArticles,
  createEmptyRefreshPayload,
  ingestSourceConfigs
} = require('./newsAggregatorIngestion');

const SCRAPE_INTERVAL_MS = parseInt(process.env.SCRAPE_INTERVAL_MS || '300000', 10);

let refreshPromise = null;
let lastRefreshAt = null;
let schedulerHandle = null;
let ingestionQueue = Promise.resolve();

function getLastRefreshAt() {
  return lastRefreshAt;
}

function setLastRefreshAt(value) {
  lastRefreshAt = value;
}

function enqueueIngestionTask(task) {
  const queuedTask = ingestionQueue
    .catch(() => undefined)
    .then(task);

  ingestionQueue = queuedTask.catch(() => undefined);
  return queuedTask;
}

function getIngestionRuntime() {
  return {
    getLastRefreshAt,
    setLastRefreshAt
  };
}

async function ingestAllNews(options = {}) {
  const broadcast = options.broadcast !== false;

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = enqueueIngestionTask(async () => {
    try {
      const sourceConfigs = [
        ...expandConfiguredSources(),
        ...expandUserSources(database.listAllActiveUserSources())
      ];
      const payload = await ingestSourceConfigs(sourceConfigs, {
        broadcast,
        includeMaintenance: true,
        failWhenEmpty: true,
        updateRefreshTimestamp: true,
        trackIngestionRun: true
      }, getIngestionRuntime());

      logger.info(`Ingestion completed: ${payload.fetchedCount} fetched, ${payload.insertedCount} inserted, ${payload.updatedCount} updated`);
      return payload;
    } catch (error) {
      logger.error(`News ingestion failed: ${error.message}`);
      throw error.status ? error : createError(500, 'Errore durante l\'aggiornamento delle notizie.', 'SERVER_ERROR', error);
    }
  }).finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

async function refreshUserSources(userId, options = {}) {
  if (!userId) {
    return createEmptyRefreshPayload(getLastRefreshAt());
  }

  return enqueueIngestionTask(async () => {
    const selectedSourceIds = Array.isArray(options.sourceIds) && options.sourceIds.length > 0
      ? new Set(options.sourceIds)
      : null;
    const activeSources = database.listUserSources(userId)
      .filter((source) => source?.isActive !== false)
      .filter((source) => !selectedSourceIds || selectedSourceIds.has(source.id));

    if (activeSources.length === 0) {
      return createEmptyRefreshPayload(getLastRefreshAt());
    }

    return ingestSourceConfigs(expandUserSources(activeSources), {
      broadcast: options.broadcast === true,
      includeMaintenance: false,
      failWhenEmpty: false,
      updateRefreshTimestamp: false,
      trackIngestionRun: false
    }, getIngestionRuntime());
  });
}

async function ensureSeedData() {
  purgeExpiredArticles();

  if (database.countArticles() > 0) {
    return;
  }

  await ingestAllNews({ broadcast: false });
}

async function getNewsFeed(filters = {}, userContext = {}) {
  return buildNewsFeed(filters, userContext, {
    ensureSeedData,
    getLastRefreshAt
  });
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
  refreshUserSources,
  getNewsFeed,
  startScheduler,
  stopScheduler,
  newsSources,
  _groupSimilarNews: groupSimilarNews,
  _buildStableGroupId: buildStableGroupId,
  _calculateSimilarity: calculateSimilarity,
  _insertArticleIntoGroups: insertArticleIntoGroups
};
