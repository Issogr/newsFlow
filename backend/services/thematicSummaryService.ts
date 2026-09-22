import type { AppError, DateInput, DynamicRecord, NewsArticle, SummaryRecord, SummarySource } from '../utils/types';
import { createHash } from 'node:crypto';

import database from './database';
import logger from '../utils/logger';
import aiSummaryGenerator from './aiSummaryGenerator';
import readerService from './readerService';
import websocketService from './websocketService';
import { parseIntegerEnv } from '../utils/env';
import aiFeatures from '../config/aiFeatures';
import concurrency from '../utils/concurrency';
import promotionalContent from '../utils/promotionalContent';
import articleIdentity from '../utils/articleIdentity';
const { isAiToggleEnabled } = aiFeatures;
const { mapSettledWithConcurrency } = concurrency;
const { isPromotionalDealArticle } = promotionalContent;
const { normalizeArticleUrl, normalizeIdentityText } = articleIdentity;

const DEFAULT_SUMMARY_TIME_ZONE = 'Europe/Rome';
const SUMMARY_HISTORY_RETAIN_COUNT = 1;
const SUMMARY_CHECK_INTERVAL_MS = parseIntegerEnv('THEMATIC_SUMMARY_CHECK_INTERVAL_MS', 60 * 1000, { min: 1000 });
const SUMMARY_MAX_ARTICLES_PER_TOPIC = parseIntegerEnv('AI_SUMMARY_MAX_ARTICLES_PER_TOPIC', 120, { min: 1, max: 300 });
const SUMMARY_READER_PREWARM_MINUTES_BEFORE = parseIntegerEnv('AI_SUMMARY_READER_PREWARM_MINUTES_BEFORE', 30, { min: 1, max: 180 });
const SUMMARY_READER_PREWARM_CONCURRENCY = parseIntegerEnv('AI_SUMMARY_READER_PREWARM_CONCURRENCY', 2, { min: 1, max: 8 });
const SUMMARY_READER_PREWARM_RETRY_COOLDOWN_MS = parseIntegerEnv('AI_SUMMARY_READER_PREWARM_RETRY_COOLDOWN_MS', 5 * 60 * 1000, { min: 0, max: 60 * 60 * 1000 });
const SUMMARY_GENERATION_CONCURRENCY = parseIntegerEnv('AI_SUMMARY_GENERATION_CONCURRENCY', 2, { min: 1, max: 6 });
const SUMMARY_READER_TEXT_MAX_CHARS = parseIntegerEnv('AI_SUMMARY_READER_TEXT_MAX_CHARS', 3000, { min: 500, max: 12000 });
const SUMMARY_READER_TEXT_MIN_CHARS = parseIntegerEnv('AI_SUMMARY_READER_TEXT_MIN_CHARS', 250, { min: 80, max: 2000 });
const SUMMARY_FAILED_RETRY_COOLDOWN_MS = parseIntegerEnv('AI_SUMMARY_FAILED_RETRY_COOLDOWN_MS', 10 * 60 * 1000, { min: 0, max: 24 * 60 * 60 * 1000 });
const SUMMARY_INVALID_OUTPUT_MAX_RETRIES = parseIntegerEnv('AI_SUMMARY_INVALID_OUTPUT_MAX_RETRIES', 2, { min: 0, max: 10 });
const SUMMARY_PENDING_TOPIC_GRACE_MS = parseIntegerEnv('AI_SUMMARY_PENDING_TOPIC_GRACE_MS', 15 * 60 * 1000, { min: 0, max: 6 * 60 * 60 * 1000 });
const SUMMARY_PROMPT_MAX_ARTICLES = parseIntegerEnv('AI_SUMMARY_PROMPT_MAX_ARTICLES', 24, { min: 1, max: SUMMARY_MAX_ARTICLES_PER_TOPIC });
const TERMINAL_SUMMARY_STATUSES = new Set(['completed', 'empty']);
const NON_RETRYABLE_SUMMARY_FAILURE_CATEGORIES = new Set(['invalid_output']);
interface SummaryTopic {
  key: string;
  label: string;
  topics: string[];
}

interface SummaryWindow {
  periodStart: string;
  periodEnd: string;
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

interface PrewarmAttempt {
  attemptedAt: string;
  succeeded: boolean;
}

interface SummaryArticle extends NewsArticle {
  readerText?: string;
}

interface SummaryOptions extends DynamicRecord {
  broadcast?: boolean;
  canGenerateSummaries?: boolean;
  force?: boolean;
  referenceDate?: DateInput;
  window?: SummaryWindow;
}

interface ReaderCacheEntry extends DynamicRecord {
  contentText?: string;
}

interface DueSummaryResult extends DynamicRecord {
  items: SummaryRecord[];
  window: SummaryWindow;
}

const SUMMARY_TOPICS: SummaryTopic[] = [
  {
    key: 'technology',
    label: 'Technology',
    topics: ['Tecnologia']
  },
  {
    key: 'politics',
    label: 'Politics',
    topics: ['Politica']
  },
  {
    key: 'crime',
    label: 'Crime',
    topics: ['Cronaca']
  },
  {
    key: 'sport',
    label: 'Sport',
    topics: ['Sport']
  },
  {
    key: 'entertainment',
    label: 'Entertainment',
    topics: ['Spettacolo']
  },
  {
    key: 'science',
    label: 'Science',
    topics: ['Scienza']
  }
];

function getOtherSummaryTopics(topicConfig: Partial<SummaryTopic> = {}) {
  return [...new Set(SUMMARY_TOPICS
    .filter((summaryTopic) => summaryTopic.key !== topicConfig.key)
    .flatMap((summaryTopic) => summaryTopic.topics))];
}

function buildSummaryArticleQuery(topicConfig: SummaryTopic, window: SummaryWindow) {
  return {
    topics: topicConfig.topics,
    excludedTopics: getOtherSummaryTopics(topicConfig),
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    limit: SUMMARY_MAX_ARTICLES_PER_TOPIC
  };
}

let schedulerHandle: NodeJS.Timeout | null = null;
let generationPromise: Promise<DueSummaryResult | undefined> | null = null;
let pendingGenerationOptions: Array<{ key: string; options: SummaryOptions }> = [];
let prewarmPromise: Promise<DynamicRecord> | null = null;
const attemptedPrewarmArticleIdsByWindow = new Map<string, Map<string, PrewarmAttempt>>();

function getConfiguredSummaryTimeZone() {
  const configuredTimeZone = String(process.env.AI_SUMMARY_TIME_ZONE || DEFAULT_SUMMARY_TIME_ZONE).trim() || DEFAULT_SUMMARY_TIME_ZONE;

  try {
    Intl.DateTimeFormat('en-US', { timeZone: configuredTimeZone }).format(new Date());
    return configuredTimeZone;
  } catch {
    logger.warn(`Invalid AI_SUMMARY_TIME_ZONE "${configuredTimeZone}"; falling back to ${DEFAULT_SUMMARY_TIME_ZONE}`);
    return DEFAULT_SUMMARY_TIME_ZONE;
  }
}

const SUMMARY_TIME_ZONE = getConfiguredSummaryTimeZone();

function isReaderPrewarmEnabled() {
  return isAiToggleEnabled('AI_SUMMARY_READER_PREWARM_ENABLED')
    && aiSummaryGenerator.isAiSummaryGenerationAvailable();
}

function getTimeZoneParts(date: Date, timeZone = SUMMARY_TIME_ZONE): LocalDateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    second: Number(byType.second)
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone = SUMMARY_TIME_ZONE) {
  const parts = getTimeZoneParts(date, timeZone);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return localAsUtc - date.getTime();
}

function zonedDateTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }: Partial<LocalDateParts> & Pick<LocalDateParts, 'year' | 'month' | 'day'>, timeZone = SUMMARY_TIME_ZONE) {
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  let utcTime = localAsUtc;

  for (let index = 0; index < 3; index += 1) {
    const nextUtcTime = localAsUtc - getTimeZoneOffsetMs(new Date(utcTime), timeZone);
    if (nextUtcTime === utcTime) {
      break;
    }
    utcTime = nextUtcTime;
  }

  return new Date(utcTime);
}

function addCalendarDays({ year, month, day }: Pick<LocalDateParts, 'year' | 'month' | 'day'>, dayCount: number) {
  const date = new Date(Date.UTC(year, month - 1, day + dayCount, 12, 0, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function createZonedSlotDate(localDate: Pick<LocalDateParts, 'year' | 'month' | 'day'>) {
  return zonedDateTimeToUtc({ ...localDate, hour: 20, minute: 0, second: 0 });
}

function toDate(referenceDate: DateInput) {
  return referenceDate instanceof Date ? new Date(referenceDate.getTime()) : new Date(referenceDate);
}

function getDailyWindow(referenceDate: DateInput, next: boolean): SummaryWindow {
  const reference = toDate(referenceDate);
  const localToday = getTimeZoneParts(reference);
  const todayIsDue = createZonedSlotDate(localToday).getTime() <= reference.getTime();
  const endDay = addCalendarDays(localToday, (todayIsDue ? 0 : -1) + (next ? 1 : 0));
  return {
    periodStart: createZonedSlotDate(addCalendarDays(endDay, -1)).toISOString(),
    periodEnd: createZonedSlotDate(endDay).toISOString()
  };
}

function getLatestDueWindow(referenceDate: DateInput = new Date()): SummaryWindow {
  return getDailyWindow(referenceDate, false);
}

function getNextDueWindow(referenceDate: DateInput = new Date()): SummaryWindow {
  return getDailyWindow(referenceDate, true);
}

function getSummaryTopics() {
  return SUMMARY_TOPICS.map((topic) => ({ ...topic }));
}

function getRetainedPrewarmWindowEnds(referenceDate: DateInput = new Date()) {
  return new Set([
    getLatestDueWindow(referenceDate).periodEnd,
    getNextDueWindow(referenceDate).periodEnd
  ]);
}

function prunePrewarmAttempts(referenceDate: DateInput = new Date()) {
  const retainedWindowEnds = getRetainedPrewarmWindowEnds(referenceDate);
  let removedCount = 0;

  attemptedPrewarmArticleIdsByWindow.forEach((attemptedArticles, windowEnd) => {
    if (!retainedWindowEnds.has(windowEnd)) {
      attemptedPrewarmArticleIdsByWindow.delete(windowEnd);
      removedCount += attemptedArticles?.size || 0;
    }
  });

  return { removedCount, retainedWindowEnds };
}

function isPrewarmAttemptDue(attempt: PrewarmAttempt | null = null, referenceDate: DateInput = new Date()) {
  if (!attempt) {
    return true;
  }
  if (attempt.succeeded) {
    return false;
  }
  if (SUMMARY_READER_PREWARM_RETRY_COOLDOWN_MS <= 0) {
    return true;
  }

  const attemptedAtTime = Date.parse(attempt.attemptedAt || '');
  if (!Number.isFinite(attemptedAtTime)) {
    return true;
  }

  return toDate(referenceDate).getTime() - attemptedAtTime >= SUMMARY_READER_PREWARM_RETRY_COOLDOWN_MS;
}

function buildSummaryId(topicKey: string, periodStart: string, periodEnd: string) {
  return [topicKey, periodStart, periodEnd]
    .join(':')
    .replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function getSummaryFailureCategory(error: Partial<AppError> = {}) {
  if (error.code === 'OPENROUTER_PROVIDER_BACKOFF') {
    return 'provider_unavailable';
  }

  if (error.code === 'SUMMARY_VALIDATION_FAILED') {
    return 'invalid_output';
  }

  const message = String(error.message || '').toLowerCase();
  if (/timeout|timed out|rate|quota|429|503|network|fetch|econnreset|socket/u.test(message)) {
    return 'provider_unavailable';
  }

  if (/json|summary text|citation|identical|too short/u.test(message)) {
    return 'invalid_output';
  }

  return 'generation_error';
}

function isFailedSummaryRetryDue(summary: SummaryRecord = {}, referenceDate: DateInput = new Date()) {
  if (summary.status !== 'failed' && !summary.failureCategory) {
    return true;
  }

  if (hasExhaustedInvalidOutputRetries(summary)) {
    return false;
  }

  if (SUMMARY_FAILED_RETRY_COOLDOWN_MS <= 0) {
    return true;
  }

  const generatedAtTime = Date.parse(summary.lastAttemptAt || summary.generatedAt || '');
  if (!Number.isFinite(generatedAtTime)) {
    return true;
  }

  return toDate(referenceDate).getTime() - generatedAtTime >= SUMMARY_FAILED_RETRY_COOLDOWN_MS;
}

function hasExhaustedInvalidOutputRetries(summary: SummaryRecord = {}) {
  return Boolean(summary.failureCategory
    && NON_RETRYABLE_SUMMARY_FAILURE_CATEGORIES.has(summary.failureCategory)
    && Math.max(0, Number(summary.retryCount || 0) - 1) >= SUMMARY_INVALID_OUTPUT_MAX_RETRIES);
}

function shouldWaitForPendingTopicProcessing(window: Partial<SummaryWindow> = {}, options: SummaryOptions = {}) {
  if (options.force === true) {
    return false;
  }
  if (!database.hasPendingTopicProcessingForThematicSummary(window)) {
    return false;
  }
  if (SUMMARY_PENDING_TOPIC_GRACE_MS <= 0) {
    return false;
  }

  const periodEndTime = Date.parse(window.periodEnd || '');
  const referenceTime = new Date(options.referenceDate || new Date()).getTime();
  if (!Number.isFinite(periodEndTime) || !Number.isFinite(referenceTime)) {
    return true;
  }

  return referenceTime - periodEndTime < SUMMARY_PENDING_TOPIC_GRACE_MS;
}

function buildSourceList(articles: SummaryArticle[] = []) {
  return articles.map((article, index) => ({
    index: index + 1,
    articleId: article.id,
    contentHash: createHash('sha256').update(JSON.stringify([
      article.title, article.description, article.content, article.readerText,
      article.source || article.rawSource, article.url, article.pubDate
    ].map(normalizeReaderText))).digest('hex'),
    title: article.title,
    source: article.source || article.rawSource || '',
    sourceIconUrl: article.sourceIconUrl || '',
    url: article.url || '',
    publishedAt: article.pubDate || ''
  }));
}

function buildEmptySummaryPayload(topicConfig: SummaryTopic, window: SummaryWindow) {
  const textEn = `No ${topicConfig.label.toLowerCase()} stories were available for this summary window.`;
  const textIt = 'Nessuna notizia disponibile per questo topic in questa finestra di riepilogo.';

  return {
    id: buildSummaryId(topicConfig.key, window.periodStart, window.periodEnd),
    topicKey: topicConfig.key,
    topicLabel: topicConfig.label,
    topics: topicConfig.topics,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    summaryText: textEn,
    summaryTextByLocale: { en: textEn, it: textIt },
    articleCount: 0,
    sources: [],
    model: '',
    status: 'empty',
    failureCategory: '',
    retryCount: 0,
    generatedAt: new Date().toISOString()
  };
}

function normalizeReaderText(value: unknown = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isUsefulReaderText(value: unknown = '') {
  return normalizeReaderText(value).length >= SUMMARY_READER_TEXT_MIN_CHARS;
}

function filterNewsworthySummaryArticles(articles: SummaryArticle[] = []) {
  return (Array.isArray(articles) ? articles : []).filter((article) => !isPromotionalDealArticle(article));
}

function getThematicArticleIdentityKeys(article: Partial<SummaryArticle> = {}) {
  const keys: string[] = [];
  const storyGroupId = String(article.storyGroupId || '').trim();
  const articleUrl = normalizeArticleUrl(article.canonicalUrl || article.url || '');
  const title = normalizeIdentityText(article.title || '', { lowercase: true });

  if (storyGroupId) {
    keys.push(`story:${storyGroupId}`);
  }
  if (articleUrl) {
    keys.push(`url:${articleUrl}`);
  }
  if (title.length >= 16) {
    keys.push(`title:${title}`);
  }

  return keys;
}

function dedupeThematicCandidateArticles(articles: SummaryArticle[] = []) {
  const seenKeys = new Set<string>();
  const deduped: SummaryArticle[] = [];

  (Array.isArray(articles) ? articles : []).forEach((article) => {
    const keys = getThematicArticleIdentityKeys(article);
    if (keys.length > 0 && keys.some((key) => seenKeys.has(key))) {
      return;
    }

    deduped.push(article);
    keys.forEach((key) => seenKeys.add(key));
  });

  return deduped;
}

function getArticlesForSummaryTopic(topicConfig: SummaryTopic, window: SummaryWindow) {
  const articles = filterNewsworthySummaryArticles(
    database.getArticlesForThematicSummary(buildSummaryArticleQuery(topicConfig, window))
  );
  const publishersByStory = new Map<string, Set<string>>();
  const storyKey = (article: SummaryArticle) => getThematicArticleIdentityKeys(article)[0] || article.id;
  articles.forEach((article) => {
    const key = storyKey(article);
    const publishers = publishersByStory.get(key) || new Set<string>();
    publishers.add(getPromptArticleSourceKey(article));
    publishersByStory.set(key, publishers);
  });
  // ponytail: independent publisher count proxies importance; use editorial scoring if coverage evaluations need it.
  return dedupeThematicCandidateArticles([...articles].sort((left, right) => (
    publishersByStory.get(storyKey(right))!.size - publishersByStory.get(storyKey(left))!.size
  )));
}

function getCachedReaderText(articleId: string, cacheByArticleId: Map<string, ReaderCacheEntry>) {
  const cached = cacheByArticleId.get(articleId);
  if (!cached || !isUsefulReaderText(cached.contentText)) {
    return '';
  }

  return normalizeReaderText(cached.contentText).slice(0, SUMMARY_READER_TEXT_MAX_CHARS);
}

function withCachedReaderText(articles: SummaryArticle[] = []) {
  const cacheByArticleId = database.getReaderCaches(articles.map((article) => article.id));

  return articles.map((article) => ({
    ...article,
    readerText: getCachedReaderText(article.id, cacheByArticleId),
    readerTextMaxChars: SUMMARY_READER_TEXT_MAX_CHARS
  }));
}

function getPromptArticleSourceKey(article: Partial<SummaryArticle> = {}) {
  return normalizeIdentityText(article.source || article.rawSource || article.sourceId || '', { lowercase: true }) || 'unknown';
}

function selectPromptArticles(articles: SummaryArticle[] = [], maxArticles = 40) {
  const normalizedLimit = Math.max(1, Number(maxArticles) || 40);
  const uniqueArticles = dedupeThematicCandidateArticles(Array.isArray(articles) ? articles : []);
  if (uniqueArticles.length <= normalizedLimit) {
    return uniqueArticles;
  }

  const selected: SummaryArticle[] = [];
  const selectedIds = new Set<string>();
  const sourceCounts = new Map<string, number>();
  const softSourceLimit = Math.max(2, Math.ceil(normalizedLimit / 6));

  const addArticle = (article: SummaryArticle, enforceSourceLimit = true) => {
    if (!article?.id || selectedIds.has(article.id) || selected.length >= normalizedLimit) {
      return false;
    }

    const sourceKey = getPromptArticleSourceKey(article);
    if (enforceSourceLimit && (sourceCounts.get(sourceKey) || 0) >= softSourceLimit) {
      return false;
    }

    selected.push(article);
    selectedIds.add(article.id);
    sourceCounts.set(sourceKey, (sourceCounts.get(sourceKey) || 0) + 1);
    return true;
  };

  uniqueArticles.forEach((article) => addArticle(article, true));
  uniqueArticles.forEach((article) => addArticle(article, false));

  return selected;
}

function getSummarySourceArticleIds(summary: SummaryRecord = {}) {
  return (Array.isArray(summary.sources) ? summary.sources : [])
    .map((source) => String(source?.articleId || '').trim())
    .filter(Boolean);
}

function hasChangedArticleSelection(summary: SummaryRecord = {}, sources: SummarySource[] = []) {
  const previousById = new Map((summary.sources || []).map((source) => [source.articleId, source]));
  // Removed articles alone are retention, not a reason to rewrite a briefing.
  return sources.some((source) => {
    const previous = previousById.get(source.articleId);
    return !previous || Boolean(previous.contentHash && previous.contentHash !== source.contentHash);
  });
}

function broadcastSummariesRefresh(options: SummaryOptions = {}) {
  if (options.broadcast !== false) {
    websocketService.broadcastFeedRefresh({ reason: 'summaries' });
  }
}

function pruneGeneratedSummaryHistory(options: DynamicRecord = {}) {
  const result = database.pruneSummaryHistory(options);
  if ((result?.thematicSummaries || 0) > 0) {
    logger.info(`Pruned old AI summary history: thematic=${result.thematicSummaries}, periodEnd=${options.periodEnd}`);
  }
}

async function prewarmReaderCacheForDueWindow(options: SummaryOptions = {}) {
  if (!isReaderPrewarmEnabled() && options.force !== true) {
    return { skipped: true, reason: 'disabled', attemptedCount: 0 };
  }

  if (prewarmPromise && options.force !== true) {
    return prewarmPromise;
  }

  prewarmPromise = (async () => {
    const referenceDate = options.referenceDate || new Date();
    const window = options.window || getNextDueWindow(referenceDate);
    const periodEndTime = Date.parse(window.periodEnd);
    const referenceTime = new Date(referenceDate).getTime();
    const prewarmStartsAt = periodEndTime - (SUMMARY_READER_PREWARM_MINUTES_BEFORE * 60 * 1000);

    if (options.force !== true && (!Number.isFinite(periodEndTime) || referenceTime < prewarmStartsAt || referenceTime >= periodEndTime)) {
      return { skipped: true, reason: 'outside_window', attemptedCount: 0, window };
    }

    const { retainedWindowEnds } = prunePrewarmAttempts(referenceDate);
    const shouldRetainAttempts = retainedWindowEnds.has(window.periodEnd);
    const attemptedArticles = shouldRetainAttempts
      ? (attemptedPrewarmArticleIdsByWindow.get(window.periodEnd) || new Map<string, PrewarmAttempt>())
      : new Map<string, PrewarmAttempt>();
    const candidateArticlesById = new Map<string, SummaryArticle>();
    if (aiSummaryGenerator.isAiSummaryGenerationAvailable() || options.force === true) {
      SUMMARY_TOPICS.forEach((topicConfig) => {
        selectPromptArticles(getArticlesForSummaryTopic(topicConfig, window), SUMMARY_PROMPT_MAX_ARTICLES)
          .forEach((article) => candidateArticlesById.set(article.id, article));
      });
    }
    const candidateArticles = [...candidateArticlesById.values()];
    const readerCacheByArticleId = database.getReaderCaches(candidateArticles.map((article) => article.id));
    const candidates = candidateArticles.filter((article) => {
      return article?.id
        && (options.force === true || isPrewarmAttemptDue(attemptedArticles.get(article.id), referenceDate))
        && !isUsefulReaderText(readerCacheByArticleId.get(article.id)?.contentText);
    });

    if (candidates.length === 0) {
      return { skipped: false, attemptedCount: 0, window };
    }

    const attemptedAt = new Date(referenceDate).toISOString();
    candidates.forEach((article) => {
      attemptedArticles.set(article.id, { attemptedAt, succeeded: false });
    });
    if (shouldRetainAttempts) {
      attemptedPrewarmArticleIdsByWindow.set(window.periodEnd, attemptedArticles);
    }

    const results: PromiseSettledResult<boolean>[] = await mapSettledWithConcurrency(candidates, SUMMARY_READER_PREWARM_CONCURRENCY, async (article: SummaryArticle) => {
      const payload = await readerService.getReaderArticle(article.id, {
        userId: null,
        maxArticleAgeHours: null
      });
      return Boolean(payload && !payload.fallback && isUsefulReaderText(payload.contentText));
    });
    results.forEach((result: PromiseSettledResult<boolean>, index: number) => {
      const article = candidates[index];
      const attempt = attemptedArticles.get(article.id);
      if (attempt) {
        attempt.succeeded = result.status === 'fulfilled' && result.value === true;
      }
    });
    const cachedCount = results.filter((result: PromiseSettledResult<boolean>) => result.status === 'fulfilled' && result.value === true).length;

    logger.info(`Thematic summary reader prewarm completed: windowEnd=${window.periodEnd}, attempted=${candidates.length}, cached=${cachedCount}`);
    return { skipped: false, attemptedCount: candidates.length, cachedCount, window };
  })().finally(() => {
    prewarmPromise = null;
  });

  return prewarmPromise;
}

async function generateSummaryForTopic(topicConfig: SummaryTopic, window: SummaryWindow, options: SummaryOptions = {}) {
  const existingSummary = database.getThematicSummary(topicConfig.key, window.periodStart, window.periodEnd);
  const failedRetryDue = isFailedSummaryRetryDue(existingSummary || {}, options.referenceDate || new Date());
  const exhaustedInvalidOutputRetries = hasExhaustedInvalidOutputRetries(existingSummary || {});
  const canRetryExhaustedInvalidOutput = exhaustedInvalidOutputRetries && existingSummary?.status === 'failed';
  if ((existingSummary?.status === 'failed' || existingSummary?.failureCategory)
    && options.force !== true
    && !failedRetryDue
    && !canRetryExhaustedInvalidOutput) {
    logger.debug(`Thematic summary retry skipped during cooldown: topic=${topicConfig.key}, windowEnd=${window.periodEnd}`);
    return {
      summary: TERMINAL_SUMMARY_STATUSES.has(existingSummary.status || '') ? existingSummary : null,
      generatedNow: false
    };
  }

  if (shouldWaitForPendingTopicProcessing(window, options)) {
    return {
      summary: TERMINAL_SUMMARY_STATUSES.has(existingSummary?.status || '') ? existingSummary : null,
      generatedNow: false
    };
  }

  const articles = getArticlesForSummaryTopic(topicConfig, window);
  const selectedArticles = selectPromptArticles(articles, SUMMARY_PROMPT_MAX_ARTICLES);
  const enrichedArticles = withCachedReaderText(selectedArticles);
  const sources = buildSourceList(enrichedArticles);

  if (canRetryExhaustedInvalidOutput && options.force !== true && !hasChangedArticleSelection(existingSummary, sources)) {
    logger.debug(`Thematic summary retry skipped after invalid output limit: topic=${topicConfig.key}, windowEnd=${window.periodEnd}`);
    return { summary: null, generatedNow: false };
  }

  if (existingSummary?.status === 'completed' && options.force !== true) {
    if (!hasChangedArticleSelection(existingSummary, sources)) {
      return { summary: existingSummary, generatedNow: false };
    }

    logger.info(`Thematic summary input changed: topic=${topicConfig.key}, windowEnd=${window.periodEnd}, previous=${getSummarySourceArticleIds(existingSummary).length}, current=${selectedArticles.length}`);
  }

  if (articles.length === 0) {
    if (existingSummary?.status === 'empty' && options.force !== true) {
      return { summary: existingSummary, generatedNow: false };
    }

    return {
      summary: database.upsertThematicSummary(buildEmptySummaryPayload(topicConfig, window)),
      generatedNow: true
    };
  }

  if (options.canGenerateSummaries === false) {
    return { summary: null, generatedNow: false };
  }

  const basePayload = {
    id: buildSummaryId(topicConfig.key, window.periodStart, window.periodEnd),
    topicKey: topicConfig.key,
    topicLabel: topicConfig.label,
    topics: topicConfig.topics,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    articleCount: enrichedArticles.length,
    sources,
    generatedAt: new Date().toISOString()
  };

  try {
    const generated = await aiSummaryGenerator.generateSummaryForArticles({
      ...topicConfig,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd
    }, enrichedArticles);

    if (!generated) {
      return { summary: null, generatedNow: false };
    }

    return {
      summary: database.upsertThematicSummary({
        ...basePayload,
        summaryText: generated.summaryText,
        summaryTextByLocale: generated.summaryTextByLocale,
        inputArticles: generated.inputArticles,
        lastAttemptAt: basePayload.generatedAt,
        model: generated.model,
        status: 'completed',
        failureCategory: '',
        retryCount: 0
      }),
      generatedNow: true
    };
  } catch (error) {
    const failure = error as AppError;
    const failureCategory = getSummaryFailureCategory(failure);
    logger.warn(`Thematic summary generation failed: topic=${topicConfig.key}, windowEnd=${window.periodEnd}, error=${failure.message}`);
    if (existingSummary?.status === 'completed') {
      const summary = database.upsertThematicSummary({
        ...existingSummary,
        failureCategory,
        retryCount: (existingSummary.retryCount || 0) + 1,
        errorMessage: failure.message,
        lastAttemptAt: basePayload.generatedAt
      });
      if (!existingSummary.failureCategory) {
        broadcastSummariesRefresh(options);
      }
      return {
        summary,
        generatedNow: false
      };
    }

    database.upsertThematicSummary({
      ...basePayload,
      summaryText: '',
      model: aiSummaryGenerator._getConfig().model,
      status: 'failed',
      failureCategory,
      retryCount: (existingSummary?.retryCount || 0) + 1,
      errorMessage: failure.message
    });
    return { summary: null, generatedNow: false };
  }
}

async function runDueSummaries(options: SummaryOptions = {}): Promise<DueSummaryResult> {
    const referenceDate = options.referenceDate || new Date();
    const window = options.window || getLatestDueWindow(referenceDate);
    const summaries: SummaryRecord[] = [];
    let generatedCount = 0;
    const generatedTopicKeys: string[] = [];
    const canGenerateSummaries = aiSummaryGenerator.isAiSummaryGenerationAvailable();

    const topicResults = canGenerateSummaries
      ? await mapSettledWithConcurrency(SUMMARY_TOPICS, SUMMARY_GENERATION_CONCURRENCY, async (topicConfig: SummaryTopic) => ({
        topicConfig,
        result: await generateSummaryForTopic(topicConfig, window, { ...options, canGenerateSummaries })
      }))
      : [];

    for (const topicResult of topicResults) {
      if (topicResult.status === 'rejected') {
        logger.warn(`Thematic summary topic task failed: windowEnd=${window.periodEnd}, error=${topicResult.reason?.message || topicResult.reason}`);
        continue;
      }

      const { topicConfig, result } = topicResult.value;
      if (result.summary && TERMINAL_SUMMARY_STATUSES.has(result.summary.status || '')) {
        summaries.push(result.summary);
      }
      if (result.generatedNow) {
        generatedCount += 1;
        if (TERMINAL_SUMMARY_STATUSES.has(result.summary?.status || '')) {
          generatedTopicKeys.push(topicConfig.key);
        }
      }
    }

    if (generatedCount > 0) {
      if (generatedTopicKeys.length > 0) {
        pruneGeneratedSummaryHistory({
          periodEnd: window.periodEnd,
          topicKeys: generatedTopicKeys,
          thematicRetainCount: SUMMARY_HISTORY_RETAIN_COUNT
        });
      }
      logger.info(`Thematic summaries ready: windowEnd=${window.periodEnd}, count=${generatedCount}`);
      broadcastSummariesRefresh(options);
    }

    return {
      window,
      items: summaries
    };
}

function getGenerationOptionsKey(options: SummaryOptions = {}) {
  const referenceDate = options.referenceDate || new Date();
  const window = options.window || getLatestDueWindow(referenceDate);
  return [window.periodStart, window.periodEnd].join('|');
}

function mergeGenerationOptions(current: SummaryOptions | null, incoming: SummaryOptions = {}): SummaryOptions {
  return {
    ...(current || {}),
    ...incoming,
    force: current?.force === true || incoming.force === true,
    broadcast: (current ? current.broadcast !== false : false) || incoming.broadcast !== false
  };
}

async function generateDueSummaries(options: SummaryOptions = {}) {
  const optionsKey = getGenerationOptionsKey(options);
  const pendingIndex = pendingGenerationOptions.findIndex((pending) => pending.key === optionsKey);
  if (pendingIndex >= 0) {
    pendingGenerationOptions[pendingIndex].options = mergeGenerationOptions(pendingGenerationOptions[pendingIndex].options, options);
  } else {
    pendingGenerationOptions.push({ key: optionsKey, options: mergeGenerationOptions(null, options) });
  }
  if (generationPromise) {
    return generationPromise;
  }

  generationPromise = (async () => {
    let result: DueSummaryResult | undefined;
    let firstError: unknown = null;
    while (pendingGenerationOptions.length > 0) {
      const nextOptions = pendingGenerationOptions.shift()!.options;
      try {
        result = await runDueSummaries(nextOptions);
      } catch (error) {
        firstError ||= error;
      }
    }
    if (firstError) {
      throw firstError;
    }
    return result;
  })().finally(() => {
    generationPromise = null;
  });

  return generationPromise;
}

function getLatestSummaries(options: SummaryOptions = {}) {
  const canShowSummaries = aiSummaryGenerator.isAiSummaryGenerationAvailable();
  const topicConfigs = canShowSummaries ? getSummaryTopics() : [];
  const latestDueWindow = getLatestDueWindow(options.referenceDate || new Date());
  const latestSummaries: SummaryRecord[] = database.listLatestThematicSummaries(
    topicConfigs.map((topic) => topic.key),
    SUMMARY_HISTORY_RETAIN_COUNT
  );
  const latestTopicPeriodEnd = latestSummaries.reduce((latestPeriodEnd: string, summary: SummaryRecord) => {
    return !latestPeriodEnd || String(summary.periodEnd || '') > latestPeriodEnd
      ? String(summary.periodEnd || '')
      : latestPeriodEnd;
  }, '');
  const latestByKey = new Map(
    latestSummaries
      .filter((summary: SummaryRecord) => !latestTopicPeriodEnd || summary.periodEnd === latestTopicPeriodEnd)
      .map((summary: SummaryRecord) => [summary.topicKey, summary])
  );

  const topicItems = topicConfigs
    .map((topic) => {
      const summary = latestByKey.get(topic.key);
      return summary ? {
        ...summary,
        topicLabel: topic.label,
        isStale: summary.periodEnd !== latestDueWindow.periodEnd || Boolean(summary.failureCategory)
      } : null;
    })
    .filter((summary: SummaryRecord | null) => summary && summary.status !== 'empty');

  return {
    items: topicItems,
    topics: topicConfigs
  };
}

function startScheduler() {
  if (schedulerHandle) {
    return;
  }

  generateDueSummaries().catch((error) => {
    logger.warn(`Initial thematic summary generation failed: ${error.message}`);
  });

  schedulerHandle = setInterval(() => {
    prewarmReaderCacheForDueWindow().catch((error) => {
      logger.warn(`Thematic summary reader prewarm failed: ${error.message}`);
    });
    generateDueSummaries().catch((error) => {
      logger.warn(`Scheduled thematic summary generation failed: ${error.message}`);
    });
  }, SUMMARY_CHECK_INTERVAL_MS);
}

function stopScheduler() {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
  attemptedPrewarmArticleIdsByWindow.clear();
  pendingGenerationOptions = [];
}

export default {
  getLatestSummaries,
  generateDueSummaries,
  prewarmReaderCacheForDueWindow,
  startScheduler,
  stopScheduler,
  _getLatestDueWindow: getLatestDueWindow,
  _getNextDueWindow: getNextDueWindow,
  _getSummaryTimeZone: () => SUMMARY_TIME_ZONE,
  _getSummaryTopics: getSummaryTopics,
  _getPrewarmAttemptWindowCount: () => attemptedPrewarmArticleIdsByWindow.size,
  _prunePrewarmAttempts: prunePrewarmAttempts
};
