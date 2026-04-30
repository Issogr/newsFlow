const rssParser = require('./rssParser');
const database = require('./database');
const logger = require('../utils/logger');
const websocketService = require('./websocketService');
const { mapSettledWithConcurrency } = require('../utils/concurrency');
const {
  classifyTopicDetailsForArticlesWithStatus,
  isAiTopicDetectionAvailable
} = require('./aiTopicClassifier');
const { createError } = require('../utils/errorHandler');
const { parseIntegerEnv } = require('../utils/env');
const { normalizeArticleUrl } = require('../utils/articleIdentity');
const {
  normalizeIncomingArticles,
  buildInsertedGroupsByOwner
} = require('./newsAggregatorGrouping');

const ARTICLE_RETENTION_HOURS = parseIntegerEnv('ARTICLE_RETENTION_HOURS', 24, { min: 0 });
const RSS_INGESTION_CONCURRENCY = parseIntegerEnv('RSS_INGESTION_CONCURRENCY', 8, { min: 1 });
const pendingAiTopicProcessingIds = new Set();

function filterArticlesWithinRetention(articles = []) {
  if (!Array.isArray(articles) || articles.length === 0) {
    return [];
  }

  const now = Date.now();
  const cutoff = Number.isFinite(ARTICLE_RETENTION_HOURS) && ARTICLE_RETENTION_HOURS > 0
    ? now - (ARTICLE_RETENTION_HOURS * 60 * 60 * 1000)
    : null;

  return articles.filter((article) => {
    const publishedAt = Date.parse(article?.pubDate || '');
    if (!Number.isFinite(publishedAt)) {
      return true;
    }

    if (publishedAt > now) {
      return true;
    }

    if (cutoff === null) {
      return true;
    }

    return publishedAt >= cutoff;
  });
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

function normalizeSourceFetchUrl(url) {
  return normalizeArticleUrl(url || '') || String(url || '').trim();
}

function cloneArticleForSource(article = {}, source = {}) {
  const clonedArticle = {
    ...article,
    id: rssParser._buildArticleId(source, {
      link: article.url,
      title: article.title,
      description: article.description,
      content: article.content,
      pubDate: article.pubDate
    }, article.canonicalUrl || ''),
    source: source.name,
    sourceId: source.id,
    language: source.language || article.language || 'it',
    ownerUserId: source.ownerUserId || null
  };

  return clonedArticle;
}

function buildSourceFetchTasks(sourceConfigs = []) {
  const tasks = [];
  const userSourceGroups = new Map();

  sourceConfigs.forEach((source) => {
    if (!source?.ownerUserId) {
      tasks.push({ fetchSource: source, targetSources: [source], fanOut: false });
      return;
    }

    const fetchKey = normalizeSourceFetchUrl(source.url);
    const groupedSource = userSourceGroups.get(fetchKey) || {
      fetchSource: source,
      targetSources: [],
      fanOut: true
    };

    groupedSource.targetSources.push(source);
    userSourceGroups.set(fetchKey, groupedSource);
  });

  return [...tasks, ...userSourceGroups.values()];
}

async function fetchSourceTask(task) {
  const parsedArticles = await rssParser.parseFeed(task.fetchSource, {
    imageFallback: false,
    throwOnError: true
  });

  if (!task.fanOut) {
    return parsedArticles;
  }

  return task.targetSources.flatMap((source) => parsedArticles.map((article) => cloneArticleForSource(article, source)));
}

async function processAiTopicsForPendingArticles(articles = []) {
  if (!Array.isArray(articles) || articles.length === 0) {
    return;
  }

  const articleIds = articles.map((article) => article.id).filter(Boolean);

  const getRefreshUserIds = (classifiedIds = []) => {
    const classifiedIdSet = new Set(classifiedIds);
    const userIds = new Set();
    let includesGlobalArticles = false;

    articles.forEach((article) => {
      if (!classifiedIdSet.has(article?.id)) {
        return;
      }

      if (article.ownerUserId) {
        userIds.add(article.ownerUserId);
        return;
      }

      includesGlobalArticles = true;
    });

    return includesGlobalArticles ? [] : [...userIds];
  };

  try {
    const classification = await classifyTopicDetailsForArticlesWithStatus(articles);
    const topicsByArticleId = classification.topicsByArticleId || new Map();
    const attemptedArticleIds = Array.isArray(classification.attemptedArticleIds)
      ? classification.attemptedArticleIds
      : articleIds;
    const failedArticleIds = new Set(classification.failedArticleIds || []);
    const cappedArticleIds = new Set(classification.cappedArticleIds || []);
    const classifiedIds = [];
    const topicEntries = [];

    topicsByArticleId.forEach((topicDetails, articleId) => {
      if (Array.isArray(topicDetails) && topicDetails.length > 0) {
        classifiedIds.push(articleId);
        topicEntries.push({ articleId, topics: topicDetails });
      }
    });

    if (topicEntries.length > 0) {
      database.replaceTopicsForArticles(topicEntries);
      websocketService.broadcastFeedRefresh({
        userIds: getRefreshUserIds(classifiedIds),
        reason: 'topics'
      });
    }

    database.markArticlesAiTopicProcessing(classifiedIds, 'completed');
    database.markArticlesAiTopicProcessing(
      attemptedArticleIds.filter((articleId) => !classifiedIds.includes(articleId) && !failedArticleIds.has(articleId)),
      'no_topics'
    );
    database.markArticlesAiTopicProcessing([...failedArticleIds], 'failed');
    database.markArticlesAiTopicProcessing([...cappedArticleIds], 'deferred');
  } catch (error) {
    logger.warn(`Background AI topic processing failed: ${error.message}`);
    database.markArticlesAiTopicProcessing(articleIds, 'failed');
  } finally {
    articleIds.forEach((articleId) => pendingAiTopicProcessingIds.delete(articleId));
  }
}

function scheduleAiTopicsForPendingArticles(normalizedArticles = []) {
  if (!Array.isArray(normalizedArticles) || normalizedArticles.length === 0 || !isAiTopicDetectionAvailable()) {
    return;
  }

  const pendingArticleIds = database.getArticleIdsPendingAiTopicProcessing(normalizedArticles.map((article) => article.id));
  if (pendingArticleIds.length === 0) {
    return;
  }

  const pendingArticleIdSet = new Set(pendingArticleIds);
  const pendingArticles = normalizedArticles.filter((article) => {
    if (!pendingArticleIdSet.has(article.id) || pendingAiTopicProcessingIds.has(article.id)) {
      return false;
    }

    pendingAiTopicProcessingIds.add(article.id);
    return true;
  });

  if (pendingArticles.length === 0) {
    return;
  }

  setTimeout(() => {
    processAiTopicsForPendingArticles(pendingArticles);
  }, 0);
}

function resetPendingAiTopicProcessingIds() {
  pendingAiTopicProcessingIds.clear();
}

function mergeNormalizedArticleTopics(normalizedArticles = []) {
  const pendingArticleIdSet = new Set(
    database.getArticleIdsPendingAiTopicProcessing(normalizedArticles.map((article) => article.id))
  );

  database.mergeTopicsForArticles(normalizedArticles
    .filter((article) => pendingArticleIdSet.has(article.id))
    .map((article) => ({
    articleId: article.id,
    topics: article.topicDetails || article.topics
    })));
}

async function persistNormalizedArticles(normalizedArticles = []) {
  const upsertResult = database.upsertArticles(normalizedArticles);
  mergeNormalizedArticleTopics(normalizedArticles);
  scheduleAiTopicsForPendingArticles(normalizedArticles);
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

    const sourceFetchTasks = buildSourceFetchTasks(sourceConfigs);
    const results = await mapSettledWithConcurrency(sourceFetchTasks, RSS_INGESTION_CONCURRENCY, fetchSourceTask);
    const failedResults = results.filter((result) => result.status === 'rejected');
    const fetchedArticles = results
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => result.value);
    const normalizedArticles = normalizeIncomingArticles(fetchedArticles);

    if (failWhenEmpty && normalizedArticles.length === 0 && database.countArticles() === 0) {
      throw createError(503, 'Unable to connect to news feeds. Please try again later.', 'CONNECTION_ERROR');
    }

    if (sourceFetchTasks.length > 0 && failedResults.length === sourceFetchTasks.length) {
      throw createError(503, 'Unable to connect to news feeds. Please try again later.', 'CONNECTION_ERROR');
    }

    const retainedArticles = filterArticlesWithinRetention(normalizedArticles);

    const upsertResult = await persistNormalizedArticles(retainedArticles);
    const insertedGroups = buildInsertedGroupsByOwner(retainedArticles, upsertResult.insertedIds);

    if (broadcast) {
      broadcastInsertedGroups(insertedGroups);
    }

    if (updateRefreshTimestamp) {
      setLastRefreshAt(new Date().toISOString());
    }

    const payload = {
      success: true,
      fetchedCount: retainedArticles.length,
      insertedCount: upsertResult.insertedCount,
      updatedCount: upsertResult.updatedCount,
      lastRefreshAt: getLastRefreshAt()
    };

    if (ingestionRun) {
      database.completeIngestionRun(ingestionRun.id, {
        status: failedResults.length > 0 ? 'degraded' : 'completed',
        fetchedCount: payload.fetchedCount,
        insertedCount: payload.insertedCount,
        updatedCount: payload.updatedCount,
        errorMessage: failedResults.length > 0
          ? `${failedResults.length} of ${sourceFetchTasks.length} feeds failed`
          : null
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
  processAiTopicsForPendingArticles,
  scheduleAiTopicsForPendingArticles,
  _filterArticlesWithinRetention: filterArticlesWithinRetention,
  _resetPendingAiTopicProcessingIds: resetPendingAiTopicProcessingIds,
  buildSourceFetchTasks,
  cloneArticleForSource
};
