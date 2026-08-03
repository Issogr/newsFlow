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
const {
  normalizeIncomingArticles,
  buildInsertedGroupsByOwner
} = require('./newsAggregatorGrouping');
const {
  buildStoryGroupId,
  getCandidateSignature: getStoryGroupingCandidateSignature,
  findSimilarStoriesForArticle,
  isAiStoryGroupingAvailable
} = require('./aiStoryGrouper');
import type { AppError, DynamicRecord } from '../utils/types';

interface IngestionArticle extends DynamicRecord {
  aiStoryGroupMatchIds?: string[];
  aiStoryGroupStatus?: string;
  id: string;
  ownerUserId?: string | null;
  pubDate?: string;
  rawSourceId?: string;
  sourceFeedUrl?: string;
  sourceId?: string;
  sourceUpdatedAt?: string | null;
  storyGroupId?: string | null;
  topicDetails?: DynamicRecord[];
  topics?: string[];
}

interface SourceConfig extends DynamicRecord {
  id: string;
  name: string;
  ownerUserId?: string | null;
  updatedAt?: string | null;
  url: string;
}

interface SourceFetchTask {
  fanOut: boolean;
  fetchSource: SourceConfig;
  targetSources: SourceConfig[];
}

interface SourceFetchResult {
  articles: IngestionArticle[];
  fetchSource: SourceConfig;
}

interface StoryCandidate extends DynamicRecord {
  id: string;
  ownerUserId?: string | null;
  storyGroupId?: string | null;
}

interface StoryMatch extends DynamicRecord {
  articleId: string;
  confidence: number;
}

interface IngestionOptions extends DynamicRecord {
  broadcast?: boolean;
  bypassSourceFailureBackoff?: boolean;
  bypassSourceFreshness?: boolean;
  failWhenEmpty?: boolean;
  includeMaintenance?: boolean;
  sourceFetchFreshnessMs?: number;
  trackIngestionRun?: boolean;
  updateRefreshTimestamp?: boolean;
}

interface IngestionRuntime extends DynamicRecord {
  getLastRefreshAt?: () => string | null;
  setLastRefreshAt?: (value: string) => void;
}

const ARTICLE_RETENTION_HOURS = parseIntegerEnv('ARTICLE_RETENTION_HOURS', 24, { min: 0 });
const RSS_INGESTION_CONCURRENCY = parseIntegerEnv('RSS_INGESTION_CONCURRENCY', 8, { min: 1 });
const SOURCE_FETCH_FRESHNESS_MS = parseIntegerEnv('SOURCE_FETCH_FRESHNESS_MS', 5 * 60 * 1000, { min: 0 });
const SOURCE_FETCH_FRESHNESS_MAX_ENTRIES = parseIntegerEnv('SOURCE_FETCH_FRESHNESS_MAX_ENTRIES', 1000, { min: 1 });
const SOURCE_FETCH_FRESHNESS_RETENTION_MS = parseIntegerEnv(
  'SOURCE_FETCH_FRESHNESS_RETENTION_MS',
  Math.max((Number.isFinite(SOURCE_FETCH_FRESHNESS_MS) ? SOURCE_FETCH_FRESHNESS_MS : 0) * 6, 60 * 60 * 1000),
  { min: 1000 }
);
const SOURCE_FETCH_FAILURE_BACKOFF_MS = parseIntegerEnv('SOURCE_FETCH_FAILURE_BACKOFF_MS', 2 * 60 * 1000, { min: 0 });
const SOURCE_FETCH_FAILURE_MAX_BACKOFF_MS = parseIntegerEnv('SOURCE_FETCH_FAILURE_MAX_BACKOFF_MS', 30 * 60 * 1000, { min: 1000 });
const AI_STORY_GROUPING_CONCURRENCY = parseIntegerEnv('AI_STORY_GROUPING_CONCURRENCY', 1, { min: 1, max: 4 });
const AI_STORY_GROUPING_WINDOW_HOURS = parseIntegerEnv('AI_STORY_GROUPING_WINDOW_HOURS', 24, { min: 1, max: 72 });
const AI_STORY_GROUPING_CANDIDATE_LIMIT = parseIntegerEnv('AI_STORY_GROUPING_CANDIDATE_LIMIT', 64, { min: 8, max: 100 });
const AI_STORY_GROUPING_RETRY_LIMIT = parseIntegerEnv('AI_STORY_GROUPING_RETRY_LIMIT', 12, { min: 0, max: 50 });
const EXISTING_STORY_GROUP_MERGE_MIN_CONFIDENCE = 0.9;
const SUMMARY_POST_TOPIC_DEBOUNCE_MS = parseIntegerEnv('AI_SUMMARY_POST_TOPIC_DEBOUNCE_MS', 5000, { min: 0, max: 60000 });
const pendingAiTopicProcessingIds = new Set<string>();
const pendingAiStoryGroupingIds = new Set<string>();
const sourceFetchTimestamps = new Map<string, number>();
const sourceFetchResults = new Map<string, SourceFetchResult>();
const sourceFetchFailures = new Map<string, { failedAt: number; failureCount: number; retryAfter: number }>();
const sourceFetchPromises = new Map<string, Promise<SourceFetchResult>>();
let summaryAfterTopicTimer: NodeJS.Timeout | null = null;

function filterArticlesWithinRetention(articles: IngestionArticle[] = []) {
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

function createEmptyRefreshPayload(lastRefreshAt: string | null = null) {
  return {
    success: true,
    fetchedCount: 0,
    insertedCount: 0,
    updatedCount: 0,
    lastRefreshAt
  };
}

function normalizeSourceFetchUrl(url: unknown) {
  return String(url || '').trim().replace(/#.*$/u, '');
}

function getSourceFetchKey(source: Partial<SourceConfig> = {}) {
  return normalizeSourceFetchUrl(source.url) || source.id || '';
}

function pruneSourceFetchTimestamps(referenceTime = Date.now()) {
  let removedCount = 0;
  sourceFetchTimestamps.forEach((timestamp, fetchKey) => {
    if (!Number.isFinite(timestamp) || referenceTime - timestamp > SOURCE_FETCH_FRESHNESS_RETENTION_MS) {
      sourceFetchTimestamps.delete(fetchKey);
      sourceFetchResults.delete(fetchKey);
      removedCount += 1;
    }
  });

  sourceFetchFailures.forEach((failure, fetchKey) => {
    if (!failure || !Number.isFinite(failure.failedAt) || !Number.isFinite(failure.retryAfter) || referenceTime - failure.failedAt > SOURCE_FETCH_FAILURE_MAX_BACKOFF_MS * 2) {
      sourceFetchFailures.delete(fetchKey);
      removedCount += 1;
    }
  });

  while ((sourceFetchTimestamps.size + sourceFetchFailures.size) > SOURCE_FETCH_FRESHNESS_MAX_ENTRIES) {
    const oldestFetchKey = sourceFetchTimestamps.keys().next().value || sourceFetchFailures.keys().next().value;
    if (!oldestFetchKey) {
      break;
    }

    sourceFetchTimestamps.delete(oldestFetchKey);
    sourceFetchResults.delete(oldestFetchKey);
    sourceFetchFailures.delete(oldestFetchKey);
    removedCount += 1;
  }

  return removedCount;
}

function isSourceFetchFresh(source: SourceConfig, freshnessMs = SOURCE_FETCH_FRESHNESS_MS, referenceTime = Date.now()) {
  if (!Number.isFinite(freshnessMs) || freshnessMs <= 0) {
    return false;
  }

  pruneSourceFetchTimestamps(referenceTime);
  const fetchKey = getSourceFetchKey(source);
  const lastFetchedAt = fetchKey ? sourceFetchTimestamps.get(fetchKey) : null;
  return typeof lastFetchedAt === 'number' && Number.isFinite(lastFetchedAt) && referenceTime - lastFetchedAt < freshnessMs;
}

function markSourceFetched(source: SourceConfig, referenceTime = Date.now()) {
  const fetchKey = getSourceFetchKey(source);
  if (fetchKey) {
    sourceFetchTimestamps.delete(fetchKey);
    sourceFetchFailures.delete(fetchKey);
    sourceFetchTimestamps.set(fetchKey, referenceTime);
    pruneSourceFetchTimestamps(referenceTime);
  }
}

function getSourceFailureBackoffMs(failureCount = 1) {
  if (!Number.isFinite(SOURCE_FETCH_FAILURE_BACKOFF_MS) || SOURCE_FETCH_FAILURE_BACKOFF_MS <= 0) {
    return 0;
  }

  const multiplier = 2 ** Math.min(Math.max(Number(failureCount) - 1, 0), 5);
  return Math.min(SOURCE_FETCH_FAILURE_BACKOFF_MS * multiplier, SOURCE_FETCH_FAILURE_MAX_BACKOFF_MS);
}

function markSourceFetchFailed(source: SourceConfig, referenceTime = Date.now()) {
  const fetchKey = getSourceFetchKey(source);
  if (!fetchKey) {
    return;
  }

  const previousFailure = sourceFetchFailures.get(fetchKey) || { failureCount: 0 };
  const failureCount = Math.max(0, Number(previousFailure.failureCount) || 0) + 1;
  const retryAfter = referenceTime + getSourceFailureBackoffMs(failureCount);
  sourceFetchFailures.delete(fetchKey);
  sourceFetchFailures.set(fetchKey, { failedAt: referenceTime, retryAfter, failureCount });
  pruneSourceFetchTimestamps(referenceTime);
}

function isSourceFetchFailureBackoffActive(source: SourceConfig, referenceTime = Date.now()) {
  pruneSourceFetchTimestamps(referenceTime);
  const fetchKey = getSourceFetchKey(source);
  const failure = fetchKey ? sourceFetchFailures.get(fetchKey) : null;
  return Boolean(failure && Number.isFinite(failure.retryAfter) && failure.retryAfter > referenceTime);
}

function cloneArticleForSource(article: IngestionArticle, source: SourceConfig): IngestionArticle {
  return {
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
    ownerUserId: source.ownerUserId || null,
    sourceFeedUrl: normalizeSourceFetchUrl(source.url),
    sourceUpdatedAt: source.updatedAt || null
  };
}

function buildSourceFetchTasks(sourceConfigs: SourceConfig[] = []) {
  const tasks: SourceFetchTask[] = [];
  const userSourceGroups = new Map<string, SourceFetchTask>();

  sourceConfigs.forEach((source: SourceConfig) => {
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

async function fetchSourceTask(task: SourceFetchTask, options: DynamicRecord = {}): Promise<IngestionArticle[]> {
  const {
    bypassSourceFailureBackoff = false,
    bypassSourceFreshness = false,
    sourceFetchFreshnessMs = SOURCE_FETCH_FRESHNESS_MS
  } = options;

  const fetchKey = getSourceFetchKey(task.fetchSource);
  const sourceIsFresh = !bypassSourceFreshness && isSourceFetchFresh(task.fetchSource, sourceFetchFreshnessMs);
  let fetchResult = sourceIsFresh ? sourceFetchResults.get(fetchKey) : null;

  if (sourceIsFresh && !fetchResult) {
    return [];
  }

  if (!fetchResult && !bypassSourceFailureBackoff && isSourceFetchFailureBackoffActive(task.fetchSource)) {
    logger.debug(`Skipping RSS fetch during failure backoff: source=${task.fetchSource?.id || task.fetchSource?.name || task.fetchSource?.url}`);
    return [];
  }

  const existingFetch = fetchKey ? sourceFetchPromises.get(fetchKey) : null;
  const fetchPromise = fetchResult ? null : (existingFetch || (async () => {
    let articles: IngestionArticle[];
    try {
      articles = await rssParser.parseFeed(task.fetchSource, {
        imageFallback: Boolean(task.fetchSource?.ownerUserId),
        throwOnError: true
      });
    } catch (error) {
      markSourceFetchFailed(task.fetchSource);
      throw error;
    }

    markSourceFetched(task.fetchSource);
    const result = { articles, fetchSource: task.fetchSource };
    if (fetchKey) {
      sourceFetchResults.set(fetchKey, result);
    }
    return result;
  })());

  if (fetchKey && fetchPromise && !existingFetch) {
    sourceFetchPromises.set(fetchKey, fetchPromise);
  }

  if (fetchPromise) {
    try {
      fetchResult = await fetchPromise;
    } finally {
      if (fetchKey && sourceFetchPromises.get(fetchKey) === fetchPromise) {
        sourceFetchPromises.delete(fetchKey);
      }
    }
  }

  const parsedArticles = fetchResult!.fetchSource?.id === task.fetchSource?.id
    ? fetchResult!.articles
    : fetchResult!.articles.map((article: IngestionArticle) => cloneArticleForSource(article, task.fetchSource));

  if (!task.fanOut) {
    return parsedArticles;
  }

  return task.targetSources.flatMap((source: SourceConfig) => parsedArticles.map((article: IngestionArticle) => cloneArticleForSource(article, source)));
}

function getRefreshUserIdsForArticles(articles: IngestionArticle[] = [], classifiedIds: string[] = []) {
  const classifiedIdSet = new Set<string>(classifiedIds);
  const userIds = new Set<string>();
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
}

async function processAiTopicsForPendingArticles(articles: IngestionArticle[] = [], options: DynamicRecord = {}) {
  if (!Array.isArray(articles) || articles.length === 0) {
    return;
  }

  const articleIds = articles.map((article) => article.id).filter(Boolean);

  try {
    const classification = await classifyTopicDetailsForArticlesWithStatus(articles);
    const topicsByArticleId: Map<string, DynamicRecord[]> = classification.topicsByArticleId || new Map();
    const attemptedArticleIds: string[] = Array.isArray(classification.attemptedArticleIds)
      ? classification.attemptedArticleIds
      : articleIds;
    const failedArticleIds = new Set<string>(classification.failedArticleIds || []);
    const cappedArticleIds = new Set<string>(classification.cappedArticleIds || []);
    const classifiedIds: string[] = [];
    const topicEntries: DynamicRecord[] = [];

    topicsByArticleId.forEach((topicDetails: DynamicRecord[], articleId: string) => {
      if (Array.isArray(topicDetails) && topicDetails.length > 0) {
        classifiedIds.push(articleId);
        topicEntries.push({ articleId, topics: topicDetails });
      }
    });

    if (topicEntries.length > 0) {
      database.replaceTopicsForArticles(topicEntries);
      websocketService.broadcastFeedRefresh({
        userIds: getRefreshUserIdsForArticles(articles, classifiedIds),
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
    scheduleThematicSummariesAfterTopicProcessing(articles, attemptedArticleIds);
  } catch (error) {
    logger.warn(`Background AI topic processing failed: ${(error as AppError).message}`);
    database.markArticlesAiTopicProcessing(articleIds, 'failed');
  } finally {
    articleIds.forEach((articleId) => pendingAiTopicProcessingIds.delete(articleId));
    if (typeof options.onComplete === 'function') {
      try {
        options.onComplete(articles);
      } catch (error) {
        logger.warn(`Background AI topic completion hook failed: ${(error as AppError).message}`);
      }
    }
  }
}

function scheduleThematicSummariesAfterTopicProcessing(articles: IngestionArticle[] = [], classifiedArticleIds: string[] = []) {
  if (!Array.isArray(classifiedArticleIds) || classifiedArticleIds.length === 0) {
    return;
  }

  const articleById = new Map<string, IngestionArticle>((Array.isArray(articles) ? articles : []).map((article) => [article.id, article]));
  const hasGlobalArticle = classifiedArticleIds.some((articleId) => {
    const article = articleById.get(articleId);
    return article && !article.ownerUserId;
  });
  if (!hasGlobalArticle) {
    return;
  }

  if (summaryAfterTopicTimer) {
    clearTimeout(summaryAfterTopicTimer);
  }

  summaryAfterTopicTimer = setTimeout(() => {
    summaryAfterTopicTimer = null;
    thematicSummaryService.generateDueSummaries({ broadcast: true }).catch((error: AppError) => {
      logger.warn(`Thematic summary generation after topic processing failed: ${error.message}`);
    });
  }, SUMMARY_POST_TOPIC_DEBOUNCE_MS);
  summaryAfterTopicTimer.unref?.();
}

function scheduleAiTopicsForPendingArticles(normalizedArticles: IngestionArticle[] = [], options: DynamicRecord = {}) {
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

function getStoryGroupId(article?: StoryCandidate | null) {
  return String(article?.storyGroupId || '').trim();
}

function getMatchesByArticleId(matches: StoryMatch[] = []) {
  return new Map<string, StoryMatch>((Array.isArray(matches) ? matches : [])
    .filter((match) => Boolean(match.articleId))
    .map((match) => [match.articleId, match]));
}

function selectMatchesForConservativeMerge(target: StoryCandidate = { id: '' }, candidates: StoryCandidate[] = [], matches: StoryMatch[] = []) {
  const candidateById = new Map<string, StoryCandidate>(candidates.map((candidate) => [candidate.id, candidate]));
  const eligibleMatches = matches.filter((match) => candidateById.has(match.articleId));
  const matchedCandidates = eligibleMatches.map((match) => candidateById.get(match.articleId));
  const involvedStoryGroupIds = [...new Set([target, ...matchedCandidates].map(getStoryGroupId).filter(Boolean))];

  if (involvedStoryGroupIds.length <= 1) {
    return eligibleMatches;
  }

  const selectedGroupId = getStoryGroupId(target)
    || getStoryGroupId(matchedCandidates.find((candidate) => getStoryGroupId(candidate)))
    || '';

  return eligibleMatches.filter((match) => {
    const candidateGroupId = getStoryGroupId(candidateById.get(match.articleId));
    return !candidateGroupId
      || !selectedGroupId
      || candidateGroupId === selectedGroupId
      || match.confidence >= EXISTING_STORY_GROUP_MERGE_MIN_CONFIDENCE;
  });
}

async function processAiStoryGroupingForArticle(article: IngestionArticle) {
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

  if (!candidateSet.target || target.aiStoryGroupStatus === 'matched') {
    return;
  }

  if (candidates.length === 0) {
    database.markArticlesAiStoryGrouping([articleId], 'no_candidates');
    return;
  }

  const candidateSignature = getStoryGroupingCandidateSignature(target, candidates);
  if (target.aiStoryGroupStatus === 'no_match'
    && candidateSignature.length > 0
    && Array.isArray(target.aiStoryGroupMatchIds)
    && target.aiStoryGroupMatchIds.length === candidateSignature.length
    && target.aiStoryGroupMatchIds.every((candidateId: string, index: number) => candidateId === candidateSignature[index])) {
    logger.debug(`AI story grouping retry skipped: article=${articleId}, reason=unchanged_candidates, candidates=${candidateSignature.length}`);
    pendingAiStoryGroupingIds.delete(articleId);
    return;
  }

  const result = await findSimilarStoriesForArticle(target, candidates);
  const storedTarget = database.getArticleById(articleId, { maxArticleAgeHours: null });
  if (!storedTarget || storedTarget.aiStoryGroupStatus === 'matched') {
    return;
  }
  const currentTarget = { ...target, ...storedTarget };
  if (result.skipped === 'no_candidates') {
    database.markArticlesAiStoryGrouping([articleId], 'no_candidates', result.model);
    return;
  }

  if (result.skipped === 'disabled') {
    database.markArticlesAiStoryGrouping([articleId], 'deferred', result.model);
    return;
  }

  const currentCandidates: StoryCandidate[] = (result.candidates || candidates)
    .map((candidate: StoryCandidate) => {
      const storedCandidate = database.getArticleById(candidate.id, { maxArticleAgeHours: null });
      return storedCandidate ? { ...candidate, ...storedCandidate } : null;
    })
    .filter((candidate: StoryCandidate | null): candidate is StoryCandidate => candidate !== null);
  const matches = selectMatchesForConservativeMerge(currentTarget, currentCandidates, result.matches || []);
  if (matches.length === 0) {
    database.markArticlesAiStoryGrouping([articleId], 'no_match', result.model, {
      matchIds: currentCandidates.map((candidate) => candidate.id).filter(Boolean).sort(),
      reason: 'unchanged_candidate_signature'
    });
    return;
  }

  const matchesByArticleId = getMatchesByArticleId(matches);
  const matchedIds = matches.map((match) => match.articleId);
  const matchedCandidates = currentCandidates.filter((candidate) => matchedIds.includes(candidate.id));
  const involvedStoryGroupIds = [...new Set([currentTarget, ...matchedCandidates]
    .map(getStoryGroupId)
    .filter(Boolean))];
  const existingGroupId = involvedStoryGroupIds[0] || '';
  const groupedArticleIds = [...new Set([
    articleId,
    ...matchedIds,
    ...database.getArticleIdsForStoryGroups(involvedStoryGroupIds, currentTarget?.ownerUserId || null)
  ])];
  const storyGroupId = existingGroupId || buildStoryGroupId(groupedArticleIds);
  const affectedUserIds = [currentTarget, ...matchedCandidates]
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

async function processAiStoryGroupingForPendingArticles(articles: IngestionArticle[] = []) {
  if (!Array.isArray(articles) || articles.length === 0) {
    return;
  }

  try {
    const results: PromiseSettledResult<void>[] = await mapSettledWithConcurrency(articles, AI_STORY_GROUPING_CONCURRENCY, processAiStoryGroupingForArticle);
    const failedArticleIds = results
      .map((result: PromiseSettledResult<void>, index: number) => result.status === 'rejected' ? articles[index]?.id : null)
      .filter((articleId: string | null): articleId is string => Boolean(articleId));

    if (failedArticleIds.length > 0) {
      results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .forEach((result: PromiseRejectedResult) => logger.warn(`Background AI story grouping failed: ${(result.reason as AppError)?.message || result.reason}`));
      database.markArticlesAiStoryGrouping(failedArticleIds, 'failed');
    }
  } catch (error) {
    logger.warn(`Background AI story grouping failed: ${(error as AppError).message}`);
    database.markArticlesAiStoryGrouping(articles.map((article) => article.id).filter(Boolean), 'failed');
  } finally {
    articles.forEach((article) => pendingAiStoryGroupingIds.delete(article.id));
  }
}

function scheduleAiStoryGroupingForPendingArticles(normalizedArticles: IngestionArticle[] = [], options: DynamicRecord = {}) {
  if (!Array.isArray(normalizedArticles) || normalizedArticles.length === 0 || !isAiStoryGroupingAvailable()) {
    return false;
  }

  const articleIds = normalizedArticles.map((article) => article.id).filter(Boolean);
  const retryAnchorArticleIds = Array.isArray(options.retryAnchorArticleIds) ? options.retryAnchorArticleIds : articleIds;
  const retryArticleIds = AI_STORY_GROUPING_RETRY_LIMIT > 0
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

  const articleById = new Map<string, IngestionArticle>(normalizedArticles.map((article) => [article.id, article]));
  const pendingArticleIdSet = new Set<string>(pendingArticleIds);
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

function resetRuntimeStateForTests() {
  pendingAiTopicProcessingIds.clear();
  pendingAiStoryGroupingIds.clear();
  sourceFetchTimestamps.clear();
  sourceFetchResults.clear();
  sourceFetchFailures.clear();
  sourceFetchPromises.clear();
  if (summaryAfterTopicTimer) {
    clearTimeout(summaryAfterTopicTimer);
    summaryAfterTopicTimer = null;
  }
}

function mergeNormalizedArticleTopics(normalizedArticles: IngestionArticle[] = []) {
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

async function persistNormalizedArticles(normalizedArticles: IngestionArticle[] = []) {
  const currentSourceById = new Map<string, DynamicRecord | null>();
  const currentArticles = normalizedArticles.filter((article) => {
    if (!article?.ownerUserId) {
      return true;
    }

    const sourceId = article.rawSourceId || article.sourceId;
    const sourceKey = `${article.ownerUserId}:${sourceId}`;
    if (!currentSourceById.has(sourceKey)) {
      currentSourceById.set(sourceKey, database.findUserSourceById(article.ownerUserId, sourceId));
    }

    const currentSource = currentSourceById.get(sourceKey);
    return Boolean(currentSource) && currentSource?.isActive !== false
      && normalizeSourceFetchUrl(currentSource?.url) === article.sourceFeedUrl
      && (!article.sourceUpdatedAt || currentSource?.updatedAt === article.sourceUpdatedAt);
  });
  const upsertResult = database.upsertArticles(currentArticles);
  const storyGroupingOptions = { retryAnchorArticleIds: upsertResult.insertedIds || [] };
  mergeNormalizedArticleTopics(currentArticles);
  const scheduledTopicProcessing = scheduleAiTopicsForPendingArticles(currentArticles, {
    onComplete: () => scheduleAiStoryGroupingForPendingArticles(currentArticles, storyGroupingOptions)
  });

  if (!scheduledTopicProcessing) {
    scheduleAiStoryGroupingForPendingArticles(currentArticles, storyGroupingOptions);
  }
  return { ...upsertResult, articles: currentArticles };
}

function broadcastInsertedGroups(insertedGroups: { globalGroups: DynamicRecord[]; privateGroupsByUserId: Map<string, DynamicRecord[]> }) {
  if (insertedGroups.globalGroups.length > 0) {
    websocketService.broadcastNewsUpdate(insertedGroups.globalGroups);
  }

  insertedGroups.privateGroupsByUserId.forEach((groups: DynamicRecord[], userId: string) => {
    if (groups.length > 0) {
      websocketService.broadcastNewsUpdate(groups.map((group: DynamicRecord) => ({ ...group, ownerUserId: userId })));
    }
  });
}

async function ingestSourceConfigs(sourceConfigs: SourceConfig[] = [], options: IngestionOptions = {}, runtime: IngestionRuntime = {}) {
  const {
    broadcast = true,
    includeMaintenance = false,
    failWhenEmpty = false,
    bypassSourceFailureBackoff = false,
    bypassSourceFreshness = false,
    sourceFetchFreshnessMs = SOURCE_FETCH_FRESHNESS_MS,
    updateRefreshTimestamp = false,
    trackIngestionRun = false
  } = options;
  const {
    getLastRefreshAt = () => null,
    setLastRefreshAt = () => null
  } = runtime;
  let ingestionRun: DynamicRecord | null = null;

  try {
    if (includeMaintenance) {
      purgeExpiredArticles();
      cleanupRemovedConfiguredSourceData();
    }

    const sourceFetchTasks = buildSourceFetchTasks(sourceConfigs);
    if (trackIngestionRun && sourceFetchTasks.length > 0) {
      ingestionRun = database.createIngestionRun();
    }

    const results: PromiseSettledResult<IngestionArticle[]>[] = await mapSettledWithConcurrency(sourceFetchTasks, RSS_INGESTION_CONCURRENCY, (task: SourceFetchTask) => fetchSourceTask(task, {
      bypassSourceFailureBackoff,
      bypassSourceFreshness: bypassSourceFreshness || failWhenEmpty,
      sourceFetchFreshnessMs
    }));
    const failedResults = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    const fetchedArticles = results
      .filter((result): result is PromiseFulfilledResult<IngestionArticle[]> => result.status === 'fulfilled')
      .flatMap((result: PromiseFulfilledResult<IngestionArticle[]>) => result.value);
    const normalizedArticles = normalizeIncomingArticles(fetchedArticles);

    if (failWhenEmpty && normalizedArticles.length === 0 && database.countArticles({ configuredSourcesOnly: true }) === 0) {
      throw createError(503, 'Unable to connect to news feeds. Please try again later.', 'CONNECTION_ERROR');
    }

    if (sourceFetchTasks.length > 0 && failedResults.length === sourceFetchTasks.length) {
      throw createError(503, 'Unable to connect to news feeds. Please try again later.', 'CONNECTION_ERROR');
    }

    const retainedArticles = filterArticlesWithinRetention(normalizedArticles);

    const upsertResult = await persistNormalizedArticles(retainedArticles);
    const insertedGroups = buildInsertedGroupsByOwner(upsertResult.articles, upsertResult.insertedIds);

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
        errorMessage: (error as AppError).message
      });
    }

    throw error;
  }
}

module.exports = {
  createEmptyRefreshPayload,
  ingestSourceConfigs,
  scheduleAiTopicsForPendingArticles,
  scheduleAiStoryGroupingForPendingArticles,
  _filterArticlesWithinRetention: filterArticlesWithinRetention,
  _resetRuntimeStateForTests: resetRuntimeStateForTests,
  _pruneSourceFetchTimestamps: pruneSourceFetchTimestamps,
  _sourceFetchTimestamps: sourceFetchTimestamps
};
