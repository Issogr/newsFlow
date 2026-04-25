const rssParser = require('./rssParser');
const database = require('./database');
const logger = require('../utils/logger');
const websocketService = require('./websocketService');
const {
  classifyTopicDetailsForArticles,
  classifyTopicDetailsForArticlesWithStatus,
  isAiTopicDetectionAvailable
} = require('./aiTopicClassifier');
const { createError } = require('../utils/errorHandler');
const { normalizeArticleUrl } = require('../utils/articleIdentity');
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
  const parsedArticles = await rssParser.parseFeed(task.fetchSource);

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

  try {
    const classification = typeof classifyTopicDetailsForArticlesWithStatus === 'function'
      ? await classifyTopicDetailsForArticlesWithStatus(articles)
      : {
        topicsByArticleId: await classifyTopicDetailsForArticles(articles),
        attemptedArticleIds: articleIds,
        failedArticleIds: []
      };
    const topicsByArticleId = classification.topicsByArticleId || new Map();
    const attemptedArticleIds = Array.isArray(classification.attemptedArticleIds)
      ? classification.attemptedArticleIds
      : articleIds;
    const failedArticleIds = new Set(classification.failedArticleIds || []);
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
    }

    database.markArticlesAiTopicProcessing(classifiedIds, 'completed');
    database.markArticlesAiTopicProcessing(
      attemptedArticleIds.filter((articleId) => !classifiedIds.includes(articleId) && !failedArticleIds.has(articleId)),
      'no_topics'
    );
  } catch (error) {
    logger.warn(`Background AI topic processing failed: ${error.message}`);
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
  const pendingArticles = normalizedArticles.filter((article) => pendingArticleIdSet.has(article.id));

  setTimeout(() => {
    processAiTopicsForPendingArticles(pendingArticles);
  }, 0);
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
  processAiTopicsForPendingArticles,
  scheduleAiTopicsForPendingArticles,
  buildSourceFetchTasks,
  cloneArticleForSource
};
