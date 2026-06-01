const rssParser = require('./rssParser');
const database = require('./database');
const logger = require('../utils/logger');
const websocketService = require('./websocketService');
const thematicSummaryService = require('./thematicSummaryService');
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
const {
  buildStoryGroupId,
  findSimilarStoriesForArticle,
  isAiStoryGroupingAvailable
} = require('./aiStoryGrouper');

const ARTICLE_RETENTION_HOURS = parseIntegerEnv('ARTICLE_RETENTION_HOURS', 24, { min: 0 });
const RSS_INGESTION_CONCURRENCY = parseIntegerEnv('RSS_INGESTION_CONCURRENCY', 8, { min: 1 });
const SOURCE_FETCH_FRESHNESS_MS = parseIntegerEnv('SOURCE_FETCH_FRESHNESS_MS', 5 * 60 * 1000, { min: 0 });
const SOURCE_FETCH_FRESHNESS_MAX_ENTRIES = parseIntegerEnv('SOURCE_FETCH_FRESHNESS_MAX_ENTRIES', 1000, { min: 1 });
const SOURCE_FETCH_FRESHNESS_RETENTION_MS = parseIntegerEnv(
  'SOURCE_FETCH_FRESHNESS_RETENTION_MS',
  Math.max((Number.isFinite(SOURCE_FETCH_FRESHNESS_MS) ? SOURCE_FETCH_FRESHNESS_MS : 0) * 6, 60 * 60 * 1000),
  { min: 1000 }
);
const AI_STORY_GROUPING_CONCURRENCY = parseIntegerEnv('AI_STORY_GROUPING_CONCURRENCY', 1, { min: 1, max: 4 });
const AI_STORY_GROUPING_WINDOW_HOURS = parseIntegerEnv('AI_STORY_GROUPING_WINDOW_HOURS', 24, { min: 1, max: 72 });
const AI_STORY_GROUPING_CANDIDATE_LIMIT = parseIntegerEnv('AI_STORY_GROUPING_CANDIDATE_LIMIT', 64, { min: 8, max: 100 });
const AI_STORY_GROUPING_RETRY_LIMIT = parseIntegerEnv('AI_STORY_GROUPING_RETRY_LIMIT', 12, { min: 0, max: 50 });
const EXISTING_STORY_GROUP_MERGE_MIN_CONFIDENCE = 0.9;
const pendingAiTopicProcessingIds = new Set();
const pendingAiStoryGroupingIds = new Set();
const sourceFetchTimestamps = new Map();
const sourceFetchPromises = new Map();

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

function getSourceFetchKey(source = {}) {
  return normalizeSourceFetchUrl(source.url) || source.id || '';
}

function pruneSourceFetchTimestamps(referenceTime = Date.now()) {
  if (sourceFetchTimestamps.size === 0) {
    return 0;
  }

  let removedCount = 0;
  sourceFetchTimestamps.forEach((timestamp, fetchKey) => {
    if (!Number.isFinite(timestamp) || referenceTime - timestamp > SOURCE_FETCH_FRESHNESS_RETENTION_MS) {
      sourceFetchTimestamps.delete(fetchKey);
      removedCount += 1;
    }
  });

  while (sourceFetchTimestamps.size > SOURCE_FETCH_FRESHNESS_MAX_ENTRIES) {
    const oldestFetchKey = sourceFetchTimestamps.keys().next().value;
    if (!oldestFetchKey) {
      break;
    }

    sourceFetchTimestamps.delete(oldestFetchKey);
    removedCount += 1;
  }

  return removedCount;
}

function isSourceFetchFresh(source = {}, freshnessMs = SOURCE_FETCH_FRESHNESS_MS, referenceTime = Date.now()) {
  if (!Number.isFinite(freshnessMs) || freshnessMs <= 0) {
    return false;
  }

  pruneSourceFetchTimestamps(referenceTime);
  const fetchKey = getSourceFetchKey(source);
  const lastFetchedAt = fetchKey ? sourceFetchTimestamps.get(fetchKey) : null;
  return Number.isFinite(lastFetchedAt) && referenceTime - lastFetchedAt < freshnessMs;
}

function markSourceFetched(source = {}, referenceTime = Date.now()) {
  const fetchKey = getSourceFetchKey(source);
  if (fetchKey) {
    sourceFetchTimestamps.delete(fetchKey);
    sourceFetchTimestamps.set(fetchKey, referenceTime);
    pruneSourceFetchTimestamps(referenceTime);
  }
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

async function fetchSourceTask(task, options = {}) {
  const {
    bypassSourceFreshness = false,
    sourceFetchFreshnessMs = SOURCE_FETCH_FRESHNESS_MS
  } = options;

  if (!bypassSourceFreshness && isSourceFetchFresh(task.fetchSource, sourceFetchFreshnessMs)) {
    return [];
  }

  const fetchKey = getSourceFetchKey(task.fetchSource);
  const existingFetch = fetchKey ? sourceFetchPromises.get(fetchKey) : null;
  const fetchPromise = existingFetch || (async () => {
    const articles = await rssParser.parseFeed(task.fetchSource, {
      imageFallback: Boolean(task.fetchSource?.ownerUserId),
      throwOnError: true
    });

    markSourceFetched(task.fetchSource);
    return { articles, fetchSource: task.fetchSource };
  })();

  if (fetchKey && !existingFetch) {
    sourceFetchPromises.set(fetchKey, fetchPromise);
  }

  let fetchResult;
  try {
    fetchResult = await fetchPromise;
  } finally {
    if (fetchKey && sourceFetchPromises.get(fetchKey) === fetchPromise) {
      sourceFetchPromises.delete(fetchKey);
    }
  }

  const parsedArticles = fetchResult.fetchSource?.id === task.fetchSource?.id
    ? fetchResult.articles
    : fetchResult.articles.map((article) => cloneArticleForSource(article, task.fetchSource));

  if (!task.fanOut) {
    return parsedArticles;
  }

  return task.targetSources.flatMap((source) => parsedArticles.map((article) => cloneArticleForSource(article, source)));
}

async function processAiTopicsForPendingArticles(articles = [], options = {}) {
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
    scheduleThematicSummariesAfterTopicProcessing(attemptedArticleIds);
  } catch (error) {
    logger.warn(`Background AI topic processing failed: ${error.message}`);
    database.markArticlesAiTopicProcessing(articleIds, 'failed');
  } finally {
    articleIds.forEach((articleId) => pendingAiTopicProcessingIds.delete(articleId));
    if (typeof options.onComplete === 'function') {
      try {
        options.onComplete(articles);
      } catch (error) {
        logger.warn(`Background AI topic completion hook failed: ${error.message}`);
      }
    }
  }
}

function scheduleThematicSummariesAfterTopicProcessing(classifiedArticleIds = []) {
  if (!Array.isArray(classifiedArticleIds) || classifiedArticleIds.length === 0) {
    return;
  }

  setTimeout(() => {
    thematicSummaryService.generateDueSummaries({ broadcast: true }).catch((error) => {
      logger.warn(`Thematic summary generation after topic processing failed: ${error.message}`);
    });
  }, 0);
}

function scheduleAiTopicsForPendingArticles(normalizedArticles = [], options = {}) {
  if (!Array.isArray(normalizedArticles) || normalizedArticles.length === 0 || !isAiTopicDetectionAvailable()) {
    return false;
  }

  const pendingArticleIds = database.getArticleIdsPendingAiTopicProcessing(normalizedArticles.map((article) => article.id));
  if (pendingArticleIds.length === 0) {
    return false;
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
    return false;
  }

  setTimeout(() => {
    processAiTopicsForPendingArticles(pendingArticles, options);
  }, 0);

  return true;
}

function getStoryGroupId(article = {}) {
  return String(article?.storyGroupId || '').trim();
}

function getMatchesByArticleId(matches = []) {
  return new Map((Array.isArray(matches) ? matches : [])
    .map((match) => [match.articleId, match])
    .filter(([articleId]) => Boolean(articleId)));
}

function selectMatchesForConservativeMerge(target = {}, candidates = [], matches = []) {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const matchedCandidates = matches.map((match) => candidateById.get(match.articleId)).filter(Boolean);
  const involvedStoryGroupIds = [...new Set([target, ...matchedCandidates].map(getStoryGroupId).filter(Boolean))];

  if (involvedStoryGroupIds.length <= 1) {
    return matches;
  }

  const selectedGroupId = getStoryGroupId(target)
    || getStoryGroupId(matchedCandidates.find((candidate) => getStoryGroupId(candidate)))
    || '';

  return matches.filter((match) => {
    const candidateGroupId = getStoryGroupId(candidateById.get(match.articleId));
    return !candidateGroupId
      || !selectedGroupId
      || candidateGroupId === selectedGroupId
      || match.confidence >= EXISTING_STORY_GROUP_MERGE_MIN_CONFIDENCE;
  });
}

async function processAiStoryGroupingForArticle(article = {}) {
  const articleId = article?.id;
  if (!articleId) {
    return;
  }

  const candidateSet = database.getAiStoryGroupingCandidateSet(articleId, {
    windowHours: AI_STORY_GROUPING_WINDOW_HOURS,
    limit: AI_STORY_GROUPING_CANDIDATE_LIMIT
  });
  const target = candidateSet.target || article;
  const candidates = candidateSet.candidates || [];

  if (candidates.length === 0) {
    database.markArticlesAiStoryGrouping([articleId], 'no_candidates');
    return;
  }

  const result = await findSimilarStoriesForArticle(target, candidates);
  if (result.skipped === 'no_candidates') {
    database.markArticlesAiStoryGrouping([articleId], 'no_candidates', result.model);
    return;
  }

  if (result.skipped === 'disabled') {
    database.markArticlesAiStoryGrouping([articleId], 'deferred', result.model);
    return;
  }

  const matches = selectMatchesForConservativeMerge(target, candidates, result.matches || []);
  if (matches.length === 0) {
    database.markArticlesAiStoryGrouping([articleId], 'no_match', result.model);
    return;
  }

  const matchesByArticleId = getMatchesByArticleId(matches);
  const matchedIds = matches.map((match) => match.articleId);
  const matchedCandidates = candidates.filter((candidate) => matchedIds.includes(candidate.id));
  const involvedStoryGroupIds = [...new Set([target, ...matchedCandidates]
    .map(getStoryGroupId)
    .filter(Boolean))];
  const existingGroupId = involvedStoryGroupIds[0] || '';
  const groupedArticleIds = [...new Set([
    articleId,
    ...matchedIds,
    ...database.getArticleIdsForStoryGroups(involvedStoryGroupIds, target?.ownerUserId || null)
  ])];
  const storyGroupId = existingGroupId || buildStoryGroupId(groupedArticleIds);
  const affectedUserIds = [target, ...matchedCandidates]
    .map((item) => item?.ownerUserId)
    .filter(Boolean);
  const matchEvidence = matchedCandidates
    .map((candidate) => matchesByArticleId.get(candidate.id))
    .filter(Boolean);

  const updatedCount = database.assignArticlesToStoryGroup(groupedArticleIds, storyGroupId, result.model, matchEvidence);
  if (updatedCount > 0) {
    websocketService.broadcastFeedRefresh({
      userIds: affectedUserIds.length > 0 ? [...new Set(affectedUserIds)] : [],
      reason: 'stories'
    });
  }
}

async function processAiStoryGroupingForPendingArticles(articles = []) {
  if (!Array.isArray(articles) || articles.length === 0) {
    return;
  }

  try {
    const results = await mapSettledWithConcurrency(articles, AI_STORY_GROUPING_CONCURRENCY, processAiStoryGroupingForArticle);
    const failedArticleIds = results
      .map((result, index) => result.status === 'rejected' ? articles[index]?.id : null)
      .filter(Boolean);

    if (failedArticleIds.length > 0) {
      results
        .filter((result) => result.status === 'rejected')
        .forEach((result) => logger.warn(`Background AI story grouping failed: ${result.reason?.message || result.reason}`));
      database.markArticlesAiStoryGrouping(failedArticleIds, 'failed');
    }
  } catch (error) {
    logger.warn(`Background AI story grouping failed: ${error.message}`);
    database.markArticlesAiStoryGrouping(articles.map((article) => article.id).filter(Boolean), 'failed');
  } finally {
    articles.forEach((article) => pendingAiStoryGroupingIds.delete(article.id));
  }
}

function scheduleAiStoryGroupingForPendingArticles(normalizedArticles = [], options = {}) {
  if (!Array.isArray(normalizedArticles) || normalizedArticles.length === 0 || !isAiStoryGroupingAvailable()) {
    return false;
  }

  const articleIds = normalizedArticles.map((article) => article.id).filter(Boolean);
  const retryAnchorArticleIds = Array.isArray(options.retryAnchorArticleIds) ? options.retryAnchorArticleIds : articleIds;
  const retryArticleIds = AI_STORY_GROUPING_RETRY_LIMIT > 0 && typeof database.getArticleIdsForAiStoryGroupingRetry === 'function'
    ? database.getArticleIdsForAiStoryGroupingRetry(retryAnchorArticleIds, {
        windowHours: AI_STORY_GROUPING_WINDOW_HOURS,
        limit: AI_STORY_GROUPING_RETRY_LIMIT
      })
    : [];
  const pendingArticleIds = [...new Set([
    ...database.getArticleIdsPendingAiStoryGrouping(articleIds),
    ...retryArticleIds
  ])];
  if (pendingArticleIds.length === 0) {
    return false;
  }

  const articleById = new Map(normalizedArticles.map((article) => [article.id, article]));
  const pendingArticleIdSet = new Set(pendingArticleIds);
  const pendingArticles = [...pendingArticleIdSet].map((articleId) => articleById.get(articleId) || { id: articleId }).filter((article) => {
    if (!article.id || pendingAiStoryGroupingIds.has(article.id)) {
      return false;
    }

    pendingAiStoryGroupingIds.add(article.id);
    return true;
  });

  if (pendingArticles.length === 0) {
    return false;
  }

  setTimeout(() => {
    processAiStoryGroupingForPendingArticles(pendingArticles);
  }, 0);

  return true;
}

function resetPendingAiTopicProcessingIds() {
  pendingAiTopicProcessingIds.clear();
}

function resetPendingAiStoryGroupingIds() {
  pendingAiStoryGroupingIds.clear();
}

function resetSourceFetchFreshness() {
  sourceFetchTimestamps.clear();
  sourceFetchPromises.clear();
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
  const storyGroupingOptions = { retryAnchorArticleIds: upsertResult.insertedIds || [] };
  mergeNormalizedArticleTopics(normalizedArticles);
  const scheduledTopicProcessing = scheduleAiTopicsForPendingArticles(normalizedArticles, {
    onComplete: () => scheduleAiStoryGroupingForPendingArticles(normalizedArticles, storyGroupingOptions)
  });

  if (!scheduledTopicProcessing) {
    scheduleAiStoryGroupingForPendingArticles(normalizedArticles, storyGroupingOptions);
  }
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
    bypassSourceFreshness = false,
    sourceFetchFreshnessMs = SOURCE_FETCH_FRESHNESS_MS,
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
    const results = await mapSettledWithConcurrency(sourceFetchTasks, RSS_INGESTION_CONCURRENCY, (task) => fetchSourceTask(task, {
      bypassSourceFreshness: bypassSourceFreshness || failWhenEmpty,
      sourceFetchFreshnessMs
    }));
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
  processAiStoryGroupingForPendingArticles,
  scheduleAiStoryGroupingForPendingArticles,
  _filterArticlesWithinRetention: filterArticlesWithinRetention,
  _resetPendingAiTopicProcessingIds: resetPendingAiTopicProcessingIds,
  _resetPendingAiStoryGroupingIds: resetPendingAiStoryGroupingIds,
  _resetSourceFetchFreshness: resetSourceFetchFreshness,
  _pruneSourceFetchTimestamps: pruneSourceFetchTimestamps,
  _sourceFetchTimestamps: sourceFetchTimestamps,
  buildSourceFetchTasks,
  cloneArticleForSource
};
