const database = require('./database');
const logger = require('../utils/logger');
const { createError } = require('../utils/errorHandler');
const {
  newsSources,
  expandUserSources,
  getNewsFeed: buildNewsFeed,
  getReadLaterFeed: buildReadLaterFeed,
  _resetFilterStatsCache: resetFilterStatsCache
} = require('./newsAggregatorQuery');
const {
  getCanonicalSourceId
} = require('../utils/sourceCatalog');
const {
  createEmptyRefreshPayload,
  ingestSourceConfigs
} = require('./newsAggregatorIngestion');
const websocketService = require('./websocketService');
const { parseIntegerEnv } = require('../utils/env');
const thematicSummaryService = require('./thematicSummaryService');
import type { AppError, DynamicRecord, SourceDefinition } from '../utils/types';

interface UserContext extends DynamicRecord {
  excludedSourceIds?: string[];
  excludedSubSourceIds?: string[];
  userId?: string | null;
}

interface SourceSettings {
  excludedSourceIds: string[];
  excludedSubSourceIds: string[];
}

interface ActiveUser extends DynamicRecord {
  id: string;
  lastActivityAt?: string | null;
}

const SCRAPE_INTERVAL_MS = parseIntegerEnv('SCRAPE_INTERVAL_MS', 900000, { min: 1000 });
const ARTICLE_RETENTION_HOURS = parseIntegerEnv('ARTICLE_RETENTION_HOURS', 24, { min: 0 });
const MANUAL_REFRESH_COOLDOWN_MS = parseIntegerEnv('MANUAL_REFRESH_COOLDOWN_MS', 5 * 60 * 1000, { min: 0 });
const ACTIVE_SOURCE_REFRESH_WINDOW_MINUTES = parseIntegerEnv(
  'SOURCE_REFRESH_ACTIVE_WINDOW_MINUTES',
  parseIntegerEnv('ONLINE_ACTIVITY_WINDOW_MINUTES', 5, { min: 0 }),
  { min: 0 }
);

let refreshPromise: Promise<DynamicRecord> | null = null;
let lastRefreshAt: string | null = null;
let schedulerHandle: NodeJS.Timeout | null = null;
let seedIngestionPromise: Promise<unknown> | null = null;
const usersRefreshedSinceScheduledIngestion = new Set<string>();
const userImmediateRefreshPromises = new Map<string, Promise<DynamicRecord>>();
const userManualRefreshTimestamps = new Map<string, number>();

function getLastRefreshAt() {
  return lastRefreshAt;
}

function setLastRefreshAt(value: string | null) {
  lastRefreshAt = value;
}

function getIngestionRuntime() {
  return {
    getLastRefreshAt,
    setLastRefreshAt
  };
}

function hasPendingUserAssignedSourceRefresh(userContext: UserContext = {}) {
  return userContext.userId ? userImmediateRefreshPromises.has(userContext.userId) : false;
}

function getManualRefreshAllowedAt(userId: string | null | undefined, referenceTime = Date.now()) {
  if (!userId || !Number.isFinite(MANUAL_REFRESH_COOLDOWN_MS) || MANUAL_REFRESH_COOLDOWN_MS <= 0) {
    return null;
  }

  const lastRefreshAt = userManualRefreshTimestamps.get(userId);
  if (!Number.isFinite(lastRefreshAt)) {
    return null;
  }

  const allowedAt = lastRefreshAt + MANUAL_REFRESH_COOLDOWN_MS;
  return allowedAt > referenceTime ? new Date(allowedAt).toISOString() : null;
}

function getManualRefreshMeta(userContext: UserContext = {}, referenceTime = Date.now()) {
  const allowedAt = getManualRefreshAllowedAt(userContext.userId, referenceTime);
  const allowedAtTime = allowedAt ? Date.parse(allowedAt) : NaN;
  const cooldownSeconds = Number.isFinite(allowedAtTime)
    ? Math.max(0, Math.ceil((allowedAtTime - referenceTime) / 1000))
    : 0;

  return {
    manualRefreshCooldownSeconds: cooldownSeconds,
    manualRefreshAllowedAt: allowedAt,
    manualRefreshAllowed: cooldownSeconds <= 0
  };
}

function isRecentlyActive(user: ActiveUser, referenceTime = Date.now()) {
  if (!user?.lastActivityAt || !Number.isFinite(ACTIVE_SOURCE_REFRESH_WINDOW_MINUTES) || ACTIVE_SOURCE_REFRESH_WINDOW_MINUTES <= 0) {
    return false;
  }

  const activityTime = new Date(user.lastActivityAt).getTime();
  return Number.isFinite(activityTime) && activityTime >= referenceTime - (ACTIVE_SOURCE_REFRESH_WINDOW_MINUTES * 60 * 1000);
}

function getSettingsForSourceAssignment(userId: string): SourceSettings {
  const settings = database.getUserSettings(userId) || {};
  return {
    excludedSourceIds: Array.isArray(settings.excludedSourceIds) ? settings.excludedSourceIds : [],
    excludedSubSourceIds: Array.isArray(settings.excludedSubSourceIds) ? settings.excludedSubSourceIds : []
  };
}

function isConfiguredSourceAssignedToSettings(source: SourceDefinition, settings: SourceSettings) {
  const canonicalSourceId = getCanonicalSourceId(source.id, source.name);
  return !settings.excludedSourceIds.includes(canonicalSourceId)
    && !settings.excludedSubSourceIds.includes(source.id);
}

function getAssignedConfiguredSourcesForUsers(users: ActiveUser[] = []) {
  const assignedSources = new Map<string, SourceDefinition>();

  users.forEach((user: ActiveUser) => {
    const settings = getSettingsForSourceAssignment(user.id);
    newsSources
      .filter((source: SourceDefinition) => isConfiguredSourceAssignedToSettings(source, settings))
      .forEach((source: SourceDefinition) => assignedSources.set(source.id, source));
  });

  return [...assignedSources.values()];
}

function getActiveAssignedSourceConfigs(referenceTime = Date.now()) {
  const activeUsers: ActiveUser[] = database.listUsers().filter((user: ActiveUser) => isRecentlyActive(user, referenceTime));
  const activeUserIds = new Set(activeUsers.map((user: ActiveUser) => user.id));
  const assignedConfiguredSources = getAssignedConfiguredSourcesForUsers(activeUsers);
  const assignedUserSources = database.listAllActiveUserSources()
    .filter((source: SourceDefinition) => Boolean(source.userId) && activeUserIds.has(source.userId!));

  return [
    ...assignedConfiguredSources,
    ...expandUserSources(assignedUserSources)
  ];
}

function getUserAssignedSourceConfigs(userContext: UserContext = {}) {
  if (!userContext.userId) {
    return [];
  }

  const storedSettings = getSettingsForSourceAssignment(userContext.userId);
  const settings = {
    excludedSourceIds: Array.isArray(userContext.excludedSourceIds) ? userContext.excludedSourceIds : storedSettings.excludedSourceIds,
    excludedSubSourceIds: Array.isArray(userContext.excludedSubSourceIds) ? userContext.excludedSubSourceIds : storedSettings.excludedSubSourceIds
  };
  const assignedConfiguredSources = newsSources
    .filter((source: SourceDefinition) => isConfiguredSourceAssignedToSettings(source, settings));
  const assignedUserSources = database.listUserSources(userContext.userId)
    .filter((source: SourceDefinition) => source?.isActive !== false);

  return [
    ...assignedConfiguredSources,
    ...expandUserSources(assignedUserSources)
  ];
}

function startUserAssignedSourceRefresh(userContext: UserContext = {}, options: DynamicRecord = {}) {
  const userId = userContext.userId;
  const manual = options.manual === true;

  if (userId && userImmediateRefreshPromises.has(userId)) {
    return userImmediateRefreshPromises.get(userId);
  }

  if (!userId || (!options.force && usersRefreshedSinceScheduledIngestion.has(userId))) {
    return createEmptyRefreshPayload(getLastRefreshAt());
  }

  if (manual && getManualRefreshAllowedAt(userId)) {
    return createEmptyRefreshPayload(getLastRefreshAt());
  }

  usersRefreshedSinceScheduledIngestion.add(userId);
  if (manual && Number.isFinite(MANUAL_REFRESH_COOLDOWN_MS) && MANUAL_REFRESH_COOLDOWN_MS > 0) {
    userManualRefreshTimestamps.set(userId, Date.now());
  }

  const refreshTask = (async () => {
    const sourceConfigs = getUserAssignedSourceConfigs(userContext);
    if (sourceConfigs.length === 0) {
      return createEmptyRefreshPayload(getLastRefreshAt());
    }

    const payload = await ingestSourceConfigs(sourceConfigs, {
      broadcast: options.broadcast === true,
      includeMaintenance: false,
      failWhenEmpty: false,
      updateRefreshTimestamp: true,
      trackIngestionRun: false
    }, getIngestionRuntime());

    if (options.broadcastRefreshOnCompletion === true) {
      websocketService.broadcastFeedRefresh({ userIds: [userId], reason: 'news' });
    }

    return payload;
  })().catch((error: AppError) => {
    logger.warn(`Immediate assigned-source refresh failed for user ${userId}: ${error.message}`);
    return createEmptyRefreshPayload(getLastRefreshAt());
  }).finally(() => {
    userImmediateRefreshPromises.delete(userId);
  });

  userImmediateRefreshPromises.set(userId, refreshTask);
  return refreshTask;
}

async function ingestAllNews(options: DynamicRecord = {}): Promise<DynamicRecord> {
  const broadcast = options.broadcast !== false;

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const databaseIsEmpty = database.countArticles({ configuredSourcesOnly: true }) === 0;
      const sourceConfigs = databaseIsEmpty
        ? [
            ...newsSources,
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
      const ingestionError = error as AppError;
      logger.error(`News ingestion failed: ${ingestionError.message}`);
      throw ingestionError.status ? ingestionError : createError(500, 'An error occurred while refreshing news.', 'SERVER_ERROR', ingestionError);
    }
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

async function refreshUserSources(userId: string | null | undefined, options: DynamicRecord = {}) {
  if (!userId) {
    return createEmptyRefreshPayload(getLastRefreshAt());
  }

  const selectedSourceIds = Array.isArray(options.sourceIds) && options.sourceIds.length > 0
    ? new Set(options.sourceIds)
    : null;
  const activeSources = database.listUserSources(userId)
    .filter((source: SourceDefinition) => source?.isActive !== false)
    .filter((source: SourceDefinition) => !selectedSourceIds || selectedSourceIds.has(source.id));

  if (activeSources.length === 0) {
    return createEmptyRefreshPayload(getLastRefreshAt());
  }

  return ingestSourceConfigs(expandUserSources(activeSources), {
    broadcast: options.broadcast === true,
    includeMaintenance: false,
    failWhenEmpty: false,
    bypassSourceFailureBackoff: options.bypassSourceFailureBackoff === true,
    bypassSourceFreshness: options.bypassSourceFreshness !== false,
    updateRefreshTimestamp: false,
    trackIngestionRun: false
  }, getIngestionRuntime());
}

function startSeedDataRefresh() {
  if (database.countArticles({ configuredSourcesOnly: true }) > 0) {
    return null;
  }

  if (!seedIngestionPromise) {
    seedIngestionPromise = ingestAllNews({ broadcast: false })
      .catch((error: AppError) => {
        logger.warn(`Background seed ingestion failed: ${error.message}`);
      })
      .finally(() => {
        seedIngestionPromise = null;
      });
  }

  return seedIngestionPromise;
}

async function getNewsFeed(filters: DynamicRecord = {}, userContext: UserContext = {}) {
  startSeedDataRefresh();

  if (filters.refresh) {
    startUserAssignedSourceRefresh(userContext, { broadcast: false, force: true, manual: true, broadcastRefreshOnCompletion: true });
  }

  return buildNewsFeed(filters, userContext, {
    getLastRefreshAt,
    isUserRefreshPending: () => hasPendingUserAssignedSourceRefresh(userContext),
    getManualRefreshMeta: () => getManualRefreshMeta(userContext)
  });
}

async function getCachedNewsFeed(filters: DynamicRecord = {}, userContext: UserContext = {}) {
  return buildNewsFeed(filters, userContext, {
    getLastRefreshAt,
    isUserRefreshPending: () => false
  });
}

function normalizeReadLaterArticleIds(articleIds: unknown[] = []) {
  return [...new Set((Array.isArray(articleIds) ? articleIds : []).map((articleId) => String(articleId || '').trim()).filter(Boolean))].slice(0, 20);
}

async function getReadLaterFeed(filters: DynamicRecord = {}, userContext: UserContext = {}) {
  return buildReadLaterFeed(filters, userContext);
}

function saveReadLaterArticles(userContext: UserContext = {}, articleIds: unknown[] = []) {
  const userId = userContext.userId || null;
  const normalizedArticleIds = normalizeReadLaterArticleIds(articleIds);
  if (!userId || normalizedArticleIds.length === 0) {
    throw createError(400, 'Choose at least one article to save.', 'INVALID_READ_LATER_PAYLOAD');
  }

  const result = database.saveReadLaterArticles(userId, normalizedArticleIds, userContext);
  if (result.savedArticleIds.length === 0) {
    throw createError(404, 'Article not found.', 'RESOURCE_NOT_FOUND');
  }
  resetFilterStatsCache();

  return {
    success: true,
    readLater: true,
    articleIds: result.savedArticleIds,
    savedCount: result.savedCount
  };
}

function removeReadLaterArticles(userContext: UserContext = {}, articleIds: unknown[] = []) {
  const userId = userContext.userId || null;
  const normalizedArticleIds = normalizeReadLaterArticleIds(articleIds);
  if (!userId || normalizedArticleIds.length === 0) {
    throw createError(400, 'Choose at least one article to remove.', 'INVALID_READ_LATER_PAYLOAD');
  }

  const result = database.removeReadLaterArticles(userId, normalizedArticleIds, {
    maxArticleAgeHours: ARTICLE_RETENTION_HOURS
  });
  resetFilterStatsCache();

  return {
    success: true,
    readLater: false,
    articleIds: result.removedArticleIds,
    removedCount: result.removedCount,
    deletedExpiredArticleCount: result.deletedExpiredArticleCount
  };
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

  thematicSummaryService.startScheduler();
}

function stopScheduler() {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
  thematicSummaryService.stopScheduler();
}

function resetImmediateRefreshState() {
  usersRefreshedSinceScheduledIngestion.clear();
  userImmediateRefreshPromises.clear();
  userManualRefreshTimestamps.clear();
  seedIngestionPromise = null;
  resetFilterStatsCache();
}

process.on('exit', stopScheduler);

module.exports = {
  ingestAllNews,
  refreshUserSources,
  getNewsFeed,
  getCachedNewsFeed,
  getReadLaterFeed,
  saveReadLaterArticles,
  removeReadLaterArticles,
  startScheduler,
  stopScheduler,
  newsSources,
  _getActiveAssignedSourceConfigs: getActiveAssignedSourceConfigs,
  _hasPendingUserAssignedSourceRefresh: hasPendingUserAssignedSourceRefresh,
  _startUserAssignedSourceRefresh: startUserAssignedSourceRefresh,
  _startSeedDataRefresh: startSeedDataRefresh,
  _resetImmediateRefreshState: resetImmediateRefreshState
};
