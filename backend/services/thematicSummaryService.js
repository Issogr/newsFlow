const database = require('./database');
const logger = require('../utils/logger');
const aiSummaryGenerator = require('./aiSummaryGenerator');
const aiPodcastGenerator = require('./aiPodcastGenerator');
const readerService = require('./readerService');
const websocketService = require('./websocketService');
const { parseIntegerEnv } = require('../utils/env');
const { readAiToggleValue } = require('../config/aiFeatures');
const { mapSettledWithConcurrency } = require('../utils/concurrency');
const { isPromotionalDealArticle } = require('../utils/promotionalContent');
const { normalizeArticleUrl, normalizeIdentityText } = require('../utils/articleIdentity');

const DEFAULT_SUMMARY_TIME_ZONE = 'Europe/Rome';
const SUMMARY_GENERATION_HOURS = [7, 19];
const PODCAST_GENERATION_HOURS = [7, 19];
const PODCAST_HISTORY_RETAIN_COUNT = parseIntegerEnv('AI_PODCAST_HISTORY_RETAIN_COUNT', 2, { min: 1, max: 10 });
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
const PODCAST_TTS_RETRY_COOLDOWN_MS = parseIntegerEnv('AI_PODCAST_TTS_RETRY_COOLDOWN_MS', 10 * 60 * 1000, { min: 0, max: 24 * 60 * 60 * 1000 });
const PODCAST_TTS_MAX_RETRIES = parseIntegerEnv('AI_PODCAST_TTS_MAX_RETRIES', 4, { min: 0, max: 20 });
const TERMINAL_SUMMARY_STATUSES = new Set(['completed', 'empty']);
const TERMINAL_PODCAST_STATUSES = new Set(['completed', 'empty', 'failed']);
const NON_RETRYABLE_SUMMARY_FAILURE_CATEGORIES = new Set(['invalid_output', 'invalid_script']);
const SUMMARY_TOPICS = [
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

function getOtherSummaryTopics(topicConfig = {}) {
  return [...new Set(SUMMARY_TOPICS
    .filter((summaryTopic) => summaryTopic.key !== topicConfig.key)
    .flatMap((summaryTopic) => summaryTopic.topics))];
}

function buildSummaryArticleQuery(topicConfig, window) {
  return {
    topics: topicConfig.topics,
    excludedTopics: getOtherSummaryTopics(topicConfig),
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    limit: SUMMARY_MAX_ARTICLES_PER_TOPIC
  };
}

let schedulerHandle = null;
let generationPromise = null;
let prewarmPromise = null;
const attemptedPrewarmArticleIdsByWindow = new Map();

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
  const enabledValue = readAiToggleValue('AI_SUMMARY_READER_PREWARM_ENABLED');
  return enabledValue !== 'false' && aiSummaryGenerator.isAiSummaryGenerationAvailable();
}

function getTimeZoneParts(date, timeZone = SUMMARY_TIME_ZONE) {
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

function getTimeZoneOffsetMs(date, timeZone = SUMMARY_TIME_ZONE) {
  const parts = getTimeZoneParts(date, timeZone);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return localAsUtc - date.getTime();
}

function zonedDateTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone = SUMMARY_TIME_ZONE) {
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

function addCalendarDays({ year, month, day }, dayCount) {
  const date = new Date(Date.UTC(year, month - 1, day + dayCount, 12, 0, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function createZonedSlotDate(localDate, hour, timeZone = SUMMARY_TIME_ZONE) {
  return zonedDateTimeToUtc({
    year: localDate.year,
    month: localDate.month,
    day: localDate.day,
    hour,
    minute: 0,
    second: 0
  }, timeZone);
}

function getLatestDueWindow(referenceDate = new Date(), generationHours = SUMMARY_GENERATION_HOURS) {
  const reference = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const localToday = getTimeZoneParts(reference, SUMMARY_TIME_ZONE);
  const todaySlots = generationHours.map((hour) => createZonedSlotDate(localToday, hour, SUMMARY_TIME_ZONE));
  const dueSlotIndex = todaySlots.findLastIndex((slotDate) => slotDate.getTime() <= reference.getTime());

  if (dueSlotIndex >= 0) {
    const periodEnd = todaySlots[dueSlotIndex];
    const periodStart = dueSlotIndex === 0
      ? createZonedSlotDate(addCalendarDays(localToday, -1), generationHours[generationHours.length - 1], SUMMARY_TIME_ZONE)
      : todaySlots[dueSlotIndex - 1];

    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString()
    };
  }

  const yesterday = addCalendarDays(localToday, -1);
  const periodEnd = createZonedSlotDate(yesterday, generationHours[generationHours.length - 1], SUMMARY_TIME_ZONE);
  const periodStart = createZonedSlotDate(yesterday, generationHours[generationHours.length - 2], SUMMARY_TIME_ZONE);

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString()
  };
}

function getNextDueWindow(referenceDate = new Date(), generationHours = SUMMARY_GENERATION_HOURS) {
  const reference = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const localToday = getTimeZoneParts(reference, SUMMARY_TIME_ZONE);
  const todaySlots = generationHours.map((hour) => createZonedSlotDate(localToday, hour, SUMMARY_TIME_ZONE));
  const nextSlotIndex = todaySlots.findIndex((slotDate) => slotDate.getTime() > reference.getTime());

  if (nextSlotIndex >= 0) {
    const periodEnd = todaySlots[nextSlotIndex];
    const periodStart = nextSlotIndex === 0
      ? createZonedSlotDate(addCalendarDays(localToday, -1), generationHours[generationHours.length - 1], SUMMARY_TIME_ZONE)
      : todaySlots[nextSlotIndex - 1];

    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString()
    };
  }

  const tomorrow = addCalendarDays(localToday, 1);
  const periodStart = createZonedSlotDate(localToday, generationHours[generationHours.length - 1], SUMMARY_TIME_ZONE);
  const periodEnd = createZonedSlotDate(tomorrow, generationHours[0], SUMMARY_TIME_ZONE);

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString()
  };
}

function getLatestDuePodcastWindow(referenceDate = new Date()) {
  return getLatestDueWindow(referenceDate, PODCAST_GENERATION_HOURS);
}

function getPodcastWindowSlot(summary = {}) {
  const periodEnd = new Date(summary.periodEnd || '');
  if (Number.isNaN(periodEnd.getTime())) {
    return '';
  }

  return getTimeZoneParts(periodEnd, SUMMARY_TIME_ZONE).hour < 12 ? 'morning' : 'evening';
}

function getLatestPodcastSummariesBySlot(limit = PODCAST_HISTORY_RETAIN_COUNT) {
  const requestedLimit = Math.max(PODCAST_HISTORY_RETAIN_COUNT * 3, 6);
  const summaries = typeof database.listLatestPodcastSummaries === 'function'
    ? database.listLatestPodcastSummaries(requestedLimit)
    : [database.getLatestPodcastSummary()].filter(Boolean);
  const bySlot = new Map();

  summaries.forEach((summary) => {
    const podcastSlot = getPodcastWindowSlot(summary);
    if (!podcastSlot || bySlot.has(podcastSlot)) {
      return;
    }

    bySlot.set(podcastSlot, { ...summary, podcastSlot });
  });

  return [...bySlot.values()].slice(0, Math.max(1, Number(limit) || 1));
}

function getSummaryWindowSlot(summary = {}) {
  const periodEnd = new Date(summary.periodEnd || '');
  if (Number.isNaN(periodEnd.getTime())) {
    return '';
  }

  const hour = getTimeZoneParts(periodEnd, SUMMARY_TIME_ZONE).hour;
  if (hour < 10) {
    return 'morning';
  }
  if (hour < 16) {
    return 'lunch';
  }

  return 'evening';
}

function getSummaryTopics() {
  return SUMMARY_TOPICS.map((topic) => ({ ...topic }));
}

function getRetainedPrewarmWindowEnds(referenceDate = new Date()) {
  return new Set([
    getLatestDueWindow(referenceDate).periodEnd,
    getNextDueWindow(referenceDate).periodEnd
  ]);
}

function prunePrewarmAttempts(referenceDate = new Date()) {
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

function isPrewarmAttemptDue(attempt = null, referenceDate = new Date()) {
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

  return new Date(referenceDate).getTime() - attemptedAtTime >= SUMMARY_READER_PREWARM_RETRY_COOLDOWN_MS;
}

function buildSummaryId(topicKey, periodStart, periodEnd) {
  return [topicKey, periodStart, periodEnd]
    .join(':')
    .replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function buildPodcastSummaryId(periodStart, periodEnd) {
  return buildSummaryId('podcast', periodStart, periodEnd);
}

function getSummaryFailureCategory(error = {}) {
  if (error.code === 'PODCAST_SCRIPT_VALIDATION_FAILED') {
    return 'invalid_script';
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

function getPodcastAudioFailureCategory(error = {}) {
  if (error.code === 'PODCAST_TTS_PROVIDER_ERROR') {
    return 'provider_unavailable';
  }

  return 'tts_failed';
}

function isFailedSummaryRetryDue(summary = {}, referenceDate = new Date()) {
  if (summary.status !== 'failed') {
    return true;
  }

  if (NON_RETRYABLE_SUMMARY_FAILURE_CATEGORIES.has(summary.failureCategory)
    && Math.max(0, Number(summary.retryCount || 0) - 1) >= SUMMARY_INVALID_OUTPUT_MAX_RETRIES) {
    return false;
  }

  if (SUMMARY_FAILED_RETRY_COOLDOWN_MS <= 0) {
    return true;
  }

  const generatedAtTime = Date.parse(summary.generatedAt || '');
  if (!Number.isFinite(generatedAtTime)) {
    return true;
  }

  return new Date(referenceDate).getTime() - generatedAtTime >= SUMMARY_FAILED_RETRY_COOLDOWN_MS;
}

function shouldWaitForPendingTopicProcessing(window = {}, options = {}) {
  if (options.force === true || typeof database.hasPendingTopicProcessingForThematicSummary !== 'function') {
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

function buildSourceList(articles = []) {
  return articles.map((article, index) => ({
    index: index + 1,
    articleId: article.id,
    title: article.title,
    source: article.source || article.rawSource || '',
    sourceIconUrl: article.sourceIconUrl || '',
    url: article.url || '',
    publishedAt: article.pubDate || ''
  }));
}

function buildEmptySummaryPayload(topicConfig, window) {
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

function buildEmptyPodcastPayload(window) {
  return {
    id: buildPodcastSummaryId(window.periodStart, window.periodEnd),
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    title: 'No podcast available',
    scriptText: '',
    titleByLocale: { en: 'No podcast available', it: 'Podcast non disponibile' },
    scriptTextByLocale: { en: '', it: '' },
    articleCount: 0,
    sources: [],
    model: '',
    audioStatus: 'not_available',
    audioFailureCategory: '',
    audioRetryCount: 0,
    status: 'empty',
    failureCategory: 'empty_window',
    retryCount: 0,
    generatedAt: new Date().toISOString()
  };
}

function normalizeReaderText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isUsefulReaderText(value = '') {
  return normalizeReaderText(value).length >= SUMMARY_READER_TEXT_MIN_CHARS;
}

function filterNewsworthySummaryArticles(articles = []) {
  return (Array.isArray(articles) ? articles : []).filter((article) => !isPromotionalDealArticle(article));
}

function getThematicArticleIdentityKeys(article = {}) {
  const keys = [];
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

function dedupeArticlesByIdentity(articles = [], getIdentityKeys) {
  const seenKeys = new Set();
  const deduped = [];

  (Array.isArray(articles) ? articles : []).forEach((article) => {
    const keys = getIdentityKeys(article);
    if (keys.length > 0 && keys.some((key) => seenKeys.has(key))) {
      return;
    }

    deduped.push(article);
    keys.forEach((key) => seenKeys.add(key));
  });

  return deduped;
}

function dedupeThematicCandidateArticles(articles = []) {
  return dedupeArticlesByIdentity(articles, getThematicArticleIdentityKeys);
}

function getArticlesForSummaryTopic(topicConfig, window) {
  return dedupeThematicCandidateArticles(filterNewsworthySummaryArticles(
    database.getArticlesForThematicSummary(buildSummaryArticleQuery(topicConfig, window))
  ));
}

function createSummaryArticleContext(window) {
  const articlesByTopicKey = new Map();

  return {
    getArticlesForTopic(topicConfig) {
      if (!articlesByTopicKey.has(topicConfig.key)) {
        articlesByTopicKey.set(topicConfig.key, getArticlesForSummaryTopic(topicConfig, window));
      }

      return articlesByTopicKey.get(topicConfig.key) || [];
    }
  };
}

function getReaderCacheMap(articleIds = []) {
  const normalizedArticleIds = [...new Set((Array.isArray(articleIds) ? articleIds : [])
    .map((articleId) => String(articleId || '').trim())
    .filter(Boolean))];

  if (normalizedArticleIds.length === 0) {
    return new Map();
  }

  if (typeof database.getReaderCaches === 'function') {
    return database.getReaderCaches(normalizedArticleIds, null);
  }

  return new Map(normalizedArticleIds.map((articleId) => [articleId, database.getReaderCache(articleId, null)]));
}

function getCachedReaderText(articleId, cacheByArticleId = null) {
  const cached = cacheByArticleId instanceof Map
    ? cacheByArticleId.get(articleId)
    : database.getReaderCache(articleId, null);
  if (!isUsefulReaderText(cached?.contentText)) {
    return '';
  }

  return normalizeReaderText(cached.contentText).slice(0, SUMMARY_READER_TEXT_MAX_CHARS);
}

function withCachedReaderText(articles = []) {
  const cacheByArticleId = getReaderCacheMap(articles.map((article) => article.id));

  return articles.map((article) => ({
    ...article,
    readerText: getCachedReaderText(article.id, cacheByArticleId),
    readerTextMaxChars: SUMMARY_READER_TEXT_MAX_CHARS
  }));
}

function getPodcastArticleIdentityKeys(article = {}) {
  const keys = [];
  const articleId = String(article.id || '').trim();
  const storyGroupId = String(article.storyGroupId || '').trim();
  const articleUrl = normalizeArticleUrl(article.canonicalUrl || article.url || '');
  const title = normalizeIdentityText(article.title || '', { lowercase: true });
  const source = normalizeIdentityText(article.source || article.rawSource || article.sourceId || '', { lowercase: true });

  if (articleId) {
    keys.push(`id:${articleId}`);
  }
  if (storyGroupId) {
    keys.push(`story:${storyGroupId}`);
  }
  if (articleUrl) {
    keys.push(`url:${articleUrl}`);
  }
  if (title && source) {
    keys.push(`title-source:${source}:${title}`);
  }

  return keys;
}

function dedupePodcastCandidateArticles(articles = []) {
  return dedupeArticlesByIdentity(articles, getPodcastArticleIdentityKeys);
}

function getCandidateArticlesForWindow(window, articleContext = null) {
  const candidates = [];
  SUMMARY_TOPICS.forEach((topicConfig) => {
    const articles = articleContext?.getArticlesForTopic
      ? articleContext.getArticlesForTopic(topicConfig)
      : getArticlesForSummaryTopic(topicConfig, window);

    articles.forEach((article) => {
      if (article?.id) {
        candidates.push(article);
      }
    });
  });

  return dedupePodcastCandidateArticles(candidates);
}

function sortArticlesForPodcast(articles = []) {
  return [...articles].sort((left, right) => {
    const dateComparison = String(right.pubDate || '').localeCompare(String(left.pubDate || ''));
    return dateComparison || String(right.id || '').localeCompare(String(left.id || ''));
  });
}

function getPodcastScriptTextByLocale(summary = {}) {
  const summaryTextByLocale = summary.summaryTextByLocale && typeof summary.summaryTextByLocale === 'object'
    ? summary.summaryTextByLocale
    : {};
  const entries = Object.entries(summaryTextByLocale)
    .map(([locale, text]) => [String(locale || '').trim().toLowerCase(), String(text || '').trim()])
    .filter(([locale, text]) => locale && text);

  if (entries.length === 0 && summary.summaryText) {
    entries.push(['en', String(summary.summaryText || '').trim()]);
  }

  return Object.fromEntries(entries);
}

function buildPodcastUpdatePayload(summary = {}, updates = {}) {
  const scriptTextByLocale = getPodcastScriptTextByLocale(summary);
  return {
    id: summary.id || buildPodcastSummaryId(summary.periodStart, summary.periodEnd),
    periodStart: summary.periodStart,
    periodEnd: summary.periodEnd,
    title: summary.title || summary.titleByLocale?.en || summary.titleByLocale?.it || 'News podcast',
    scriptText: scriptTextByLocale.en || scriptTextByLocale.it,
    titleByLocale: summary.titleByLocale || { en: summary.title || 'News podcast', it: summary.title || 'Podcast news' },
    scriptTextByLocale,
    sources: summary.sources || [],
    articleCount: summary.articleCount || 0,
    model: summary.model || aiPodcastGenerator._getScriptConfig().model,
    status: summary.status || 'completed',
    ...updates,
    generatedAt: new Date().toISOString()
  };
}

function broadcastSummariesRefresh(options = {}) {
  if (options.broadcast !== false) {
    websocketService.broadcastFeedRefresh({ reason: 'summaries' });
  }
}

function pruneGeneratedSummaryHistory(options = {}) {
  if (typeof database.pruneSummaryHistory !== 'function') {
    return;
  }

  const result = database.pruneSummaryHistory(options);
  if ((result?.thematicSummaries || 0) > 0 || (result?.podcastSummaries || 0) > 0) {
    logger.info(`Pruned old AI summary history: thematic=${result.thematicSummaries || 0}, podcasts=${result.podcastSummaries || 0}, periodEnd=${options.periodEnd}`);
  }
}

function getAudioRetryDelayMs(summary = {}) {
  if (PODCAST_TTS_RETRY_COOLDOWN_MS <= 0) {
    return 0;
  }

  const retryCount = Math.max(0, Number(summary.audioRetryCount) || 0);
  const multiplier = 2 ** Math.min(Math.max(retryCount - 1, 0), 4);
  return Math.min(PODCAST_TTS_RETRY_COOLDOWN_MS * multiplier, 24 * 60 * 60 * 1000);
}

function isPodcastAudioRetryDue(summary = {}, options = {}) {
  if (PODCAST_TTS_MAX_RETRIES <= 0 || Number(summary.audioRetryCount || 0) >= PODCAST_TTS_MAX_RETRIES) {
    return false;
  }

  const failedAtTime = Date.parse(summary.audioFailedAt || '');
  if (!Number.isFinite(failedAtTime)) {
    return true;
  }

  return new Date(options.referenceDate || new Date()).getTime() - failedAtTime >= getAudioRetryDelayMs(summary);
}

function isSamePodcastAudioConfig(audio = {}, ttsConfig = {}, expectedVoice = '') {
  return audio.audioModel === ttsConfig.model && audio.audioVoice === expectedVoice;
}

function getPodcastAudioLocalesToGenerate(summary = {}, options = {}) {
  if (summary.status !== 'completed') {
    return [];
  }

  const scriptTextByLocale = getPodcastScriptTextByLocale(summary);
  const enabledLocales = aiPodcastGenerator._getEnabledPodcastLocales();
  const localesWithScripts = enabledLocales.filter((locale) => scriptTextByLocale[locale]);
  if (localesWithScripts.length === 0) {
    return [];
  }

  const ttsConfig = aiPodcastGenerator._getTtsConfig();
  if (!ttsConfig.enabled) {
    logger.info(`AI podcast audio retry skipped: reason=${ttsConfig.apiKey ? 'disabled' : 'missing_api_key'}, windowEnd=${summary.periodEnd}`);
    return [];
  }

  const expectedVoice = aiPodcastGenerator._getTtsVoice();
  return localesWithScripts.filter((locale) => {
    const audio = summary.audioByLocale?.[locale] || (summary.audioLocale === locale ? summary : null) || {};
    const sameAudioConfig = isSamePodcastAudioConfig(audio, ttsConfig, expectedVoice);
    const audioMatchesConfig = audio.audioStatus === 'completed'
      && audio.audioModel === ttsConfig.model
      && audio.audioVoice === expectedVoice;
    if (audioMatchesConfig) {
      return false;
    }

    if (audio.audioStatus === 'failed' && sameAudioConfig && !isPodcastAudioRetryDue(audio, options)) {
      logger.debug(`AI podcast audio retry skipped during cooldown: locale=${locale}, windowEnd=${summary.periodEnd}`);
      return false;
    }

    return true;
  });
}

function shouldRetryPodcastAudio(summary = {}, options = {}) {
  return getPodcastAudioLocalesToGenerate(summary, options).length > 0;
}

async function retryPodcastAudio(summary = {}, options = {}) {
  if (!shouldRetryPodcastAudio(summary, options)) {
    return { summary, generatedNow: false };
  }

  const ttsConfig = aiPodcastGenerator._getTtsConfig();
  const expectedVoice = aiPodcastGenerator._getTtsVoice();
  const scriptTextByLocale = getPodcastScriptTextByLocale(summary);
  const localesToGenerate = getPodcastAudioLocalesToGenerate(summary, options);
  const generatingAudioByLocale = Object.fromEntries(localesToGenerate.map((locale) => {
    const audio = summary.audioByLocale?.[locale] || {};
    const sameAudioConfig = isSamePodcastAudioConfig(audio, ttsConfig, expectedVoice);
    const currentAudioRetryCount = sameAudioConfig ? Math.max(0, Number(audio.audioRetryCount) || 0) : 0;
    return [locale, {
      audioStatus: 'generating',
      audioErrorMessage: '',
      audioFailureCategory: '',
      audioModel: ttsConfig.model,
      audioVoice: expectedVoice,
      audioRetryCount: currentAudioRetryCount,
      audioFailedAt: audio.audioFailedAt || null
    }];
  }));
  const generatingSummary = database.upsertPodcastSummary(buildPodcastUpdatePayload(summary, {
    audioByLocale: generatingAudioByLocale,
    status: 'completed'
  }));
  broadcastSummariesRefresh(options);

  const completedAudioByLocale = {};
  for (const locale of localesToGenerate) {
    const previousAudio = generatingSummary.audioByLocale?.[locale] || {};
    const currentAudioRetryCount = Math.max(0, Number(previousAudio.audioRetryCount) || 0);
    try {
      const audio = await aiPodcastGenerator.generateAudioForLocale(scriptTextByLocale[locale], locale);
      completedAudioByLocale[locale] = audio ? {
        audio,
        audioStatus: 'completed',
        audioErrorMessage: '',
        audioFailureCategory: '',
        audioModel: audio.model || ttsConfig.model,
        audioVoice: audio.voice || expectedVoice,
        audioRetryCount: 0,
        audioFailedAt: null
      } : {
        audioStatus: 'not_available',
        audioErrorMessage: '',
        audioFailureCategory: '',
        audioRetryCount: currentAudioRetryCount,
        audioFailedAt: null,
        audioModel: ttsConfig.model,
        audioVoice: expectedVoice
      };
    } catch (error) {
      const failedAt = new Date().toISOString();
      logger.warn(`AI podcast audio retry failed: locale=${locale}, windowEnd=${summary.periodEnd}, error=${error.message}`);
      completedAudioByLocale[locale] = {
        audioStatus: 'failed',
        audioErrorMessage: error.message,
        audioFailureCategory: getPodcastAudioFailureCategory(error),
        audioModel: ttsConfig.model,
        audioVoice: expectedVoice,
        audioRetryCount: currentAudioRetryCount + 1,
        audioFailedAt: failedAt
      };
    }
  }

  const completedSummary = database.upsertPodcastSummary(buildPodcastUpdatePayload(generatingSummary, {
    audioByLocale: completedAudioByLocale,
    status: 'completed'
  }));
  broadcastSummariesRefresh(options);
  return {
    summary: completedSummary,
    generatedNow: Object.values(completedAudioByLocale).some((audio) => audio.audioStatus === 'completed')
  };
}

async function prewarmReaderCacheForDueWindow(options = {}) {
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
    const attemptedArticles = shouldRetainAttempts ? (attemptedPrewarmArticleIdsByWindow.get(window.periodEnd) || new Map()) : new Map();
    const candidateArticles = getCandidateArticlesForWindow(window);
    const readerCacheByArticleId = getReaderCacheMap(candidateArticles.map((article) => article.id));
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

    const results = await mapSettledWithConcurrency(candidates, SUMMARY_READER_PREWARM_CONCURRENCY, async (article) => {
      const payload = await readerService.getReaderArticle(article.id, {
        userId: null,
        maxArticleAgeHours: null
      });
      return payload && !payload.fallback && isUsefulReaderText(payload.contentText);
    });
    results.forEach((result, index) => {
      const article = candidates[index];
      const attempt = attemptedArticles.get(article.id);
      if (attempt) {
        attempt.succeeded = result.status === 'fulfilled' && result.value === true;
      }
    });
    const cachedCount = results.filter((result) => result.status === 'fulfilled' && result.value === true).length;

    logger.info(`Thematic summary reader prewarm completed: windowEnd=${window.periodEnd}, attempted=${candidates.length}, cached=${cachedCount}`);
    return { skipped: false, attemptedCount: candidates.length, cachedCount, window };
  })().finally(() => {
    prewarmPromise = null;
  });

  return prewarmPromise;
}

async function generateSummaryForTopic(topicConfig, window, options = {}) {
  const existingSummary = database.getThematicSummary(topicConfig.key, window.periodStart, window.periodEnd);
  if (existingSummary?.status === 'completed' && options.force !== true) {
    return { summary: existingSummary, generatedNow: false };
  }
  if (existingSummary?.status === 'failed' && options.force !== true && !isFailedSummaryRetryDue(existingSummary, options.referenceDate || new Date())) {
    logger.debug(`Thematic summary retry skipped during cooldown: topic=${topicConfig.key}, windowEnd=${window.periodEnd}`);
    return { summary: null, generatedNow: false };
  }

  const articles = options.articleContext?.getArticlesForTopic
    ? options.articleContext.getArticlesForTopic(topicConfig)
    : getArticlesForSummaryTopic(topicConfig, window);

  if (articles.length === 0) {
    if (shouldWaitForPendingTopicProcessing(window, options)) {
      return { summary: null, generatedNow: false };
    }

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

  const enrichedArticles = withCachedReaderText(articles);
  const sources = buildSourceList(enrichedArticles);
  const basePayload = {
    id: buildSummaryId(topicConfig.key, window.periodStart, window.periodEnd),
    topicKey: topicConfig.key,
    topicLabel: topicConfig.label,
    topics: topicConfig.topics,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    articleCount: articles.length,
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
        model: generated.model,
        status: 'completed',
        failureCategory: '',
        retryCount: 0
      }),
      generatedNow: true
    };
  } catch (error) {
    const failureCategory = getSummaryFailureCategory(error);
    logger.warn(`Thematic summary generation failed: topic=${topicConfig.key}, windowEnd=${window.periodEnd}, error=${error.message}`);
    database.upsertThematicSummary({
      ...basePayload,
      summaryText: '',
      model: aiSummaryGenerator._getConfig().model,
      status: 'failed',
      failureCategory,
      retryCount: (existingSummary?.retryCount || 0) + 1,
      errorMessage: error.message
    });
    return { summary: null, generatedNow: false };
  }
}

async function generatePodcastForWindow(window, options = {}) {
  const existingSummary = database.getPodcastSummary(window.periodStart, window.periodEnd);
  if (existingSummary?.status === 'completed' && options.force !== true) {
    return retryPodcastAudio(existingSummary, options);
  }
  if (existingSummary?.status === 'failed' && options.force !== true && !isFailedSummaryRetryDue(existingSummary, options.referenceDate || new Date())) {
    logger.debug(`AI podcast retry skipped during cooldown: windowEnd=${window.periodEnd}`);
    return { summary: null, generatedNow: false };
  }

  const articles = sortArticlesForPodcast(getCandidateArticlesForWindow(window, options.articleContext));
  if (articles.length === 0) {
    if (shouldWaitForPendingTopicProcessing(window, options)) {
      return { summary: null, generatedNow: false };
    }

    if (existingSummary?.status === 'empty' && options.force !== true) {
      return { summary: existingSummary, generatedNow: false };
    }

    return {
      summary: database.upsertPodcastSummary(buildEmptyPodcastPayload(window)),
      generatedNow: true
    };
  }

  const enrichedArticles = withCachedReaderText(articles);
  const sources = buildSourceList(enrichedArticles);
  const basePayload = {
    id: buildPodcastSummaryId(window.periodStart, window.periodEnd),
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    articleCount: enrichedArticles.length,
    sources,
    generatedAt: new Date().toISOString()
  };

  try {
    const generated = await aiPodcastGenerator.generatePodcastForArticles(window, enrichedArticles);
    if (!generated) {
      return { summary: null, generatedNow: false };
    }
    const audioFailedAt = generated.audioStatus === 'failed' ? new Date().toISOString() : null;

    return {
      summary: database.upsertPodcastSummary({
        ...basePayload,
        title: generated.title,
        scriptText: generated.scriptText,
        titleByLocale: generated.titleByLocale,
        scriptTextByLocale: generated.scriptTextByLocale,
        model: generated.model,
        audioByLocale: generated.audioByLocale,
        audioLocale: generated.audioLocale,
        audio: generated.audio,
        audioStatus: generated.audioStatus,
        audioErrorMessage: generated.audioErrorMessage,
        audioFailureCategory: generated.audioFailureCategory || '',
        audioModel: generated.audio?.model || aiPodcastGenerator._getTtsConfig().model,
        audioVoice: generated.audio?.voice || aiPodcastGenerator._getTtsVoice(),
        audioRetryCount: generated.audioStatus === 'failed' ? 1 : 0,
        audioFailedAt,
        status: 'completed',
        failureCategory: '',
        retryCount: 0
      }),
      generatedNow: true
    };
  } catch (error) {
    const failureCategory = getSummaryFailureCategory(error);
    logger.warn(`AI podcast generation failed: windowEnd=${window.periodEnd}, error=${error.message}`);
    const failedSummary = database.upsertPodcastSummary({
      ...basePayload,
      title: 'News podcast',
      scriptText: '',
      titleByLocale: { en: 'News podcast', it: 'Podcast news' },
      scriptTextByLocale: { en: '', it: '' },
      model: aiPodcastGenerator._getScriptConfig().model,
      status: 'failed',
      failureCategory,
      retryCount: (existingSummary?.retryCount || 0) + 1,
      errorMessage: error.message
    });
    return { summary: failedSummary, generatedNow: true };
  }
}

async function generateDueSummaries(options = {}) {
  if (generationPromise && options.force !== true) {
    return generationPromise;
  }

  generationPromise = (async () => {
    const referenceDate = options.referenceDate || new Date();
    const summaryWindow = options.summaryWindow || options.window || getLatestDueWindow(referenceDate);
    const podcastWindow = options.podcastWindow || options.window || getLatestDuePodcastWindow(referenceDate);
    const summaryArticleContext = options.summaryArticleContext || options.articleContext || createSummaryArticleContext(summaryWindow);
    const podcastArticleContext = options.podcastArticleContext
      || (summaryWindow.periodStart === podcastWindow.periodStart && summaryWindow.periodEnd === podcastWindow.periodEnd
        ? summaryArticleContext
        : createSummaryArticleContext(podcastWindow));
    const summaries = [];
    let generatedCount = 0;
    const generatedTopicKeys = [];
    let generatedPodcast = false;
    const canGenerateSummaries = aiSummaryGenerator.isAiSummaryGenerationAvailable();
    const canGeneratePodcast = aiPodcastGenerator.isAiPodcastGenerationAvailable();

    const topicResults = canGenerateSummaries
      ? await mapSettledWithConcurrency(SUMMARY_TOPICS, SUMMARY_GENERATION_CONCURRENCY, async (topicConfig) => ({
        topicConfig,
        result: await generateSummaryForTopic(topicConfig, summaryWindow, { ...options, canGenerateSummaries, articleContext: summaryArticleContext })
      }))
      : [];

    for (const topicResult of topicResults) {
      if (topicResult.status === 'rejected') {
        logger.warn(`Thematic summary topic task failed: windowEnd=${summaryWindow.periodEnd}, error=${topicResult.reason?.message || topicResult.reason}`);
        continue;
      }

      const { topicConfig, result } = topicResult.value;
      if (TERMINAL_SUMMARY_STATUSES.has(result.summary?.status)) {
        summaries.push(result.summary);
      }
      if (result.generatedNow) {
        generatedCount += 1;
        if (TERMINAL_SUMMARY_STATUSES.has(result.summary?.status)) {
          generatedTopicKeys.push(topicConfig.key);
        }
      }
    }

    if (canGeneratePodcast) {
      const podcastResult = await generatePodcastForWindow(podcastWindow, { ...options, articleContext: podcastArticleContext });
      if (TERMINAL_PODCAST_STATUSES.has(podcastResult.summary?.status)) {
        summaries.unshift(podcastResult.summary);
      }
      if (podcastResult.generatedNow) {
        generatedCount += 1;
        if (TERMINAL_PODCAST_STATUSES.has(podcastResult.summary?.status)) {
          generatedPodcast = true;
        }
      }
    }

    if (generatedCount > 0) {
      if (generatedTopicKeys.length > 0) {
        pruneGeneratedSummaryHistory({
          periodEnd: summaryWindow.periodEnd,
          topicKeys: generatedTopicKeys,
          podcast: false
        });
      }
      if (generatedPodcast) {
        pruneGeneratedSummaryHistory({
          periodEnd: podcastWindow.periodEnd,
          topicKeys: [],
          podcast: true,
          podcastRetainCount: PODCAST_HISTORY_RETAIN_COUNT
        });
      }
      logger.info(`Thematic summaries ready: summaryWindowEnd=${summaryWindow.periodEnd}, podcastWindowEnd=${podcastWindow.periodEnd}, count=${generatedCount}`);
      broadcastSummariesRefresh(options);
    }

    return {
      window: summaryWindow,
      podcastWindow,
      items: summaries
    };
  })().finally(() => {
    generationPromise = null;
  });

  return generationPromise;
}

function getLatestSummaries(options = {}) {
  const canShowSummaries = aiSummaryGenerator.isAiSummaryGenerationAvailable();
  const canShowPodcasts = aiPodcastGenerator.isAiPodcastGenerationAvailable();
  const topicConfigs = canShowSummaries ? getSummaryTopics() : [];
  const latestDueWindow = getLatestDueWindow(options.referenceDate || new Date());
  const latestSummaries = database.listLatestThematicSummaries(topicConfigs.map((topic) => topic.key));
  const latestTopicPeriodEnd = latestSummaries.reduce((latestPeriodEnd, summary) => {
    return !latestPeriodEnd || String(summary.periodEnd || '') > latestPeriodEnd
      ? String(summary.periodEnd || '')
      : latestPeriodEnd;
  }, '');
  const latestByKey = new Map(
    latestSummaries
      .filter((summary) => !latestTopicPeriodEnd || summary.periodEnd === latestTopicPeriodEnd)
      .map((summary) => [summary.topicKey, summary])
  );

  const topicItems = topicConfigs
    .map((topic) => {
      const summary = latestByKey.get(topic.key);
      return summary ? {
        ...summary,
        topicLabel: topic.label,
        summarySlot: getSummaryWindowSlot(summary),
        isStale: summary.periodEnd !== latestDueWindow.periodEnd
      } : null;
    })
    .filter(Boolean);
  const latestPodcasts = canShowPodcasts ? getLatestPodcastSummariesBySlot(PODCAST_HISTORY_RETAIN_COUNT) : [];

  return {
    items: [...latestPodcasts, ...topicItems],
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
}

module.exports = {
  getLatestSummaries,
  generateDueSummaries,
  prewarmReaderCacheForDueWindow,
  startScheduler,
  stopScheduler,
  _getLatestDueWindow: getLatestDueWindow,
  _getLatestDuePodcastWindow: getLatestDuePodcastWindow,
  _getNextDueWindow: getNextDueWindow,
  _getSummaryTimeZone: () => SUMMARY_TIME_ZONE,
  _getSummaryTopics: getSummaryTopics,
  _generatePodcastForWindow: generatePodcastForWindow,
  _isPromotionalDealArticle: isPromotionalDealArticle,
  _getPrewarmAttemptWindowCount: () => attemptedPrewarmArticleIdsByWindow.size,
  _prunePrewarmAttempts: prunePrewarmAttempts
};
