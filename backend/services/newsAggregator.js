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
  getCanonicalSourceId
} = require('../utils/sourceCatalog');
const {
  purgeExpiredArticles,
  createEmptyRefreshPayload,
  ingestSourceConfigs
} = require('./newsAggregatorIngestion');
const { parseIntegerEnv } = require('../utils/env');

const SCRAPE_INTERVAL_MS = parseIntegerEnv('SCRAPE_INTERVAL_MS', 900000, { min: 1000 });
const ACTIVE_SOURCE_REFRESH_WINDOW_MINUTES = parseIntegerEnv(
  'SOURCE_REFRESH_ACTIVE_WINDOW_MINUTES',
  parseIntegerEnv('ONLINE_ACTIVITY_WINDOW_MINUTES', 5, { min: 0 }),
  { min: 0 }
);

let refreshPromise = null;
let lastRefreshAt = null;
let schedulerHandle = null;
let ingestionQueue = Promise.resolve();
const usersRefreshedSinceScheduledIngestion = new Set();
const userImmediateRefreshPromises = new Map();

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

function hasPendingUserAssignedSourceRefresh(userContext = {}) {
  return Boolean(userContext.userId) && userImmediateRefreshPromises.has(userContext.userId);
}

function isRecentlyActive(user, referenceTime = Date.now()) {
  if (!user?.lastActivityAt || !Number.isFinite(ACTIVE_SOURCE_REFRESH_WINDOW_MINUTES) || ACTIVE_SOURCE_REFRESH_WINDOW_MINUTES <= 0) {
    return false;
  }

  const activityTime = new Date(user.lastActivityAt).getTime();
  return Number.isFinite(activityTime) && activityTime >= referenceTime - (ACTIVE_SOURCE_REFRESH_WINDOW_MINUTES * 60 * 1000);
}

function getSettingsForSourceAssignment(userId) {
  const settings = database.getUserSettings(userId) || {};
  return {
    excludedSourceIds: Array.isArray(settings.excludedSourceIds) ? settings.excludedSourceIds : [],
    excludedSubSourceIds: Array.isArray(settings.excludedSubSourceIds) ? settings.excludedSubSourceIds : []
  };
}

function isConfiguredSourceAssignedToSettings(source, settings = {}) {
  const canonicalSourceId = getCanonicalSourceId(source.id, source.name);
  return !settings.excludedSourceIds.includes(canonicalSourceId)
    && !settings.excludedSubSourceIds.includes(source.id);
}

function getAssignedConfiguredSourcesForUsers(users = []) {
  const assignedSources = new Map();

  users.forEach((user) => {
    const settings = getSettingsForSourceAssignment(user.id);
    expandConfiguredSources()
      .filter((source) => isConfiguredSourceAssignedToSettings(source, settings))
      .forEach((source) => assignedSources.set(source.id, source));
  });

  return [...assignedSources.values()];
}

function getActiveUsers(referenceTime = Date.now()) {
  return database.listUsers().filter((user) => isRecentlyActive(user, referenceTime));
}

function getActiveAssignedSourceConfigs(referenceTime = Date.now()) {
  const activeUsers = getActiveUsers(referenceTime);
  const activeUserIds = new Set(activeUsers.map((user) => user.id));
  const assignedConfiguredSources = getAssignedConfiguredSourcesForUsers(activeUsers);
  const assignedUserSources = database.listAllActiveUserSources()
    .filter((source) => activeUserIds.has(source.userId));

  return [
    ...assignedConfiguredSources,
    ...expandUserSources(assignedUserSources)
  ];
}

function getUserAssignedSourceConfigs(userContext = {}) {
  if (!userContext.userId) {
    return [];
  }

  const storedSettings = getSettingsForSourceAssignment(userContext.userId);
  const settings = {
    excludedSourceIds: Array.isArray(userContext.excludedSourceIds) ? userContext.excludedSourceIds : storedSettings.excludedSourceIds,
    excludedSubSourceIds: Array.isArray(userContext.excludedSubSourceIds) ? userContext.excludedSubSourceIds : storedSettings.excludedSubSourceIds
  };
  const assignedConfiguredSources = expandConfiguredSources()
    .filter((source) => isConfiguredSourceAssignedToSettings(source, settings));
  const assignedUserSources = database.listUserSources(userContext.userId)
    .filter((source) => source?.isActive !== false);

  return [
    ...assignedConfiguredSources,
    ...expandUserSources(assignedUserSources)
  ];
}

function startUserAssignedSourceRefresh(userContext = {}, options = {}) {
  const userId = userContext.userId;

  if (!userId || (!options.force && usersRefreshedSinceScheduledIngestion.has(userId))) {
    return createEmptyRefreshPayload(getLastRefreshAt());
  }

  usersRefreshedSinceScheduledIngestion.add(userId);

  const refreshTask = enqueueIngestionTask(async () => {
    const sourceConfigs = getUserAssignedSourceConfigs(userContext);
    if (sourceConfigs.length === 0) {
      return createEmptyRefreshPayload(getLastRefreshAt());
    }

    return ingestSourceConfigs(sourceConfigs, {
      broadcast: options.broadcast === true,
      includeMaintenance: false,
      failWhenEmpty: false,
      updateRefreshTimestamp: true,
      trackIngestionRun: false
    }, getIngestionRuntime());
  }).catch((error) => {
    logger.warn(`Immediate assigned-source refresh failed for user ${userId}: ${error.message}`);
    return createEmptyRefreshPayload(getLastRefreshAt());
  }).finally(() => {
    userImmediateRefreshPromises.delete(userId);
  });

  userImmediateRefreshPromises.set(userId, refreshTask);
  return refreshTask;
}

async function waitForExistingUserAssignedSourceRefresh(userContext = {}) {
  const userId = userContext.userId;
  const existingRefresh = userImmediateRefreshPromises.get(userId);

  if (!existingRefresh) {
    return createEmptyRefreshPayload(getLastRefreshAt());
  }

  return existingRefresh;
}

async function ingestAllNews(options = {}) {
  const broadcast = options.broadcast !== false;

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = enqueueIngestionTask(async () => {
    try {
      const databaseIsEmpty = database.countArticles() === 0;
      const sourceConfigs = databaseIsEmpty
        ? [
            ...expandConfiguredSources(),
            ...expandUserSources(database.listAllActiveUserSources())
          ]
        : getActiveAssignedSourceConfigs();
      const payload = await ingestSourceConfigs(sourceConfigs, {
        broadcast,
        includeMaintenance: true,
        failWhenEmpty: databaseIsEmpty && sourceConfigs.length > 0,
        updateRefreshTimestamp: sourceConfigs.length > 0,
        trackIngestionRun: true
      }, getIngestionRuntime());

      usersRefreshedSinceScheduledIngestion.clear();

      logger.info(`Ingestion completed: ${payload.fetchedCount} fetched, ${payload.insertedCount} inserted, ${payload.updatedCount} updated`);
      return payload;
    } catch (error) {
      logger.error(`News ingestion failed: ${error.message}`);
      throw error.status ? error : createError(500, 'An error occurred while refreshing news.', 'SERVER_ERROR', error);
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
  await ensureSeedData();

  if (filters.refresh) {
    await startUserAssignedSourceRefresh(userContext, { broadcast: false, force: true });
  } else if (userImmediateRefreshPromises.has(userContext.userId)) {
    await waitForExistingUserAssignedSourceRefresh(userContext);
  }

  return buildNewsFeed(filters, userContext, {
    ensureSeedData: async () => {},
    getLastRefreshAt,
    isUserRefreshPending: () => hasPendingUserAssignedSourceRefresh(userContext)
  });
}

async function getCachedNewsFeed(filters = {}, userContext = {}) {
  return buildNewsFeed(filters, userContext, {
    ensureSeedData: async () => {},
    getLastRefreshAt,
    isUserRefreshPending: () => false
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

function resetImmediateRefreshState() {
  usersRefreshedSinceScheduledIngestion.clear();
  userImmediateRefreshPromises.clear();
}

process.on('exit', stopScheduler);

module.exports = {
  ingestAllNews,
  refreshUserSources,
  getNewsFeed,
  getCachedNewsFeed,
  startScheduler,
  stopScheduler,
  newsSources,
  _getActiveAssignedSourceConfigs: getActiveAssignedSourceConfigs,
  _getUserAssignedSourceConfigs: getUserAssignedSourceConfigs,
  _isConfiguredSourceAssignedToSettings: isConfiguredSourceAssignedToSettings,
  _isRecentlyActive: isRecentlyActive,
  _hasPendingUserAssignedSourceRefresh: hasPendingUserAssignedSourceRefresh,
  _startUserAssignedSourceRefresh: startUserAssignedSourceRefresh,
  _waitForExistingUserAssignedSourceRefresh: waitForExistingUserAssignedSourceRefresh,
  _resetImmediateRefreshState: resetImmediateRefreshState
};
