const database = require('./database');
const logger = require('../utils/logger');
const aiSummaryGenerator = require('./aiSummaryGenerator');
const aiPodcastGenerator = require('./aiPodcastGenerator');
const readerService = require('./readerService');
const websocketService = require('./websocketService');
const { parseIntegerEnv } = require('../utils/env');
const { mapSettledWithConcurrency } = require('../utils/concurrency');
const { isPromotionalDealArticle } = require('../utils/promotionalContent');

const DEFAULT_SUMMARY_TIME_ZONE = 'Europe/Rome';
const SUMMARY_GENERATION_HOURS = [7, 13, 19];
const SUMMARY_CHECK_INTERVAL_MS = parseIntegerEnv('THEMATIC_SUMMARY_CHECK_INTERVAL_MS', 60 * 1000, { min: 1000 });
const SUMMARY_MAX_ARTICLES_PER_TOPIC = parseIntegerEnv('AI_SUMMARY_MAX_ARTICLES_PER_TOPIC', 120, { min: 1, max: 300 });
const SUMMARY_READER_PREWARM_MINUTES_BEFORE = parseIntegerEnv('AI_SUMMARY_READER_PREWARM_MINUTES_BEFORE', 30, { min: 1, max: 180 });
const SUMMARY_READER_PREWARM_CONCURRENCY = parseIntegerEnv('AI_SUMMARY_READER_PREWARM_CONCURRENCY', 2, { min: 1, max: 8 });
const SUMMARY_READER_TEXT_MAX_CHARS = parseIntegerEnv('AI_SUMMARY_READER_TEXT_MAX_CHARS', 3000, { min: 500, max: 12000 });
const SUMMARY_READER_TEXT_MIN_CHARS = parseIntegerEnv('AI_SUMMARY_READER_TEXT_MIN_CHARS', 250, { min: 80, max: 2000 });
const SUMMARY_FAILED_RETRY_COOLDOWN_MS = parseIntegerEnv('AI_SUMMARY_FAILED_RETRY_COOLDOWN_MS', 10 * 60 * 1000, { min: 0, max: 24 * 60 * 60 * 1000 });
const PODCAST_TTS_RETRY_COOLDOWN_MS = parseIntegerEnv('AI_PODCAST_TTS_RETRY_COOLDOWN_MS', 10 * 60 * 1000, { min: 0, max: 24 * 60 * 60 * 1000 });
const PODCAST_TTS_MAX_RETRIES = parseIntegerEnv('AI_PODCAST_TTS_MAX_RETRIES', 4, { min: 0, max: 20 });
const TERMINAL_SUMMARY_STATUSES = new Set(['completed', 'empty']);
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
  const enabledValue = String(process.env.AI_SUMMARY_READER_PREWARM_ENABLED || 'auto').trim().toLowerCase();
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

function getLatestDueWindow(referenceDate = new Date()) {
  const reference = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const localToday = getTimeZoneParts(reference, SUMMARY_TIME_ZONE);
  const todaySlots = SUMMARY_GENERATION_HOURS.map((hour) => createZonedSlotDate(localToday, hour, SUMMARY_TIME_ZONE));
  const dueSlotIndex = todaySlots.findLastIndex((slotDate) => slotDate.getTime() <= reference.getTime());

  if (dueSlotIndex >= 0) {
    const periodEnd = todaySlots[dueSlotIndex];
    const periodStart = dueSlotIndex === 0
      ? createZonedSlotDate(addCalendarDays(localToday, -1), SUMMARY_GENERATION_HOURS[SUMMARY_GENERATION_HOURS.length - 1], SUMMARY_TIME_ZONE)
      : todaySlots[dueSlotIndex - 1];

    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString()
    };
  }

  const yesterday = addCalendarDays(localToday, -1);
  const periodEnd = createZonedSlotDate(yesterday, SUMMARY_GENERATION_HOURS[SUMMARY_GENERATION_HOURS.length - 1], SUMMARY_TIME_ZONE);
  const periodStart = createZonedSlotDate(yesterday, SUMMARY_GENERATION_HOURS[SUMMARY_GENERATION_HOURS.length - 2], SUMMARY_TIME_ZONE);

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString()
  };
}

function getNextDueWindow(referenceDate = new Date()) {
  const reference = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const localToday = getTimeZoneParts(reference, SUMMARY_TIME_ZONE);
  const todaySlots = SUMMARY_GENERATION_HOURS.map((hour) => createZonedSlotDate(localToday, hour, SUMMARY_TIME_ZONE));
  const nextSlotIndex = todaySlots.findIndex((slotDate) => slotDate.getTime() > reference.getTime());

  if (nextSlotIndex >= 0) {
    const periodEnd = todaySlots[nextSlotIndex];
    const periodStart = nextSlotIndex === 0
      ? createZonedSlotDate(addCalendarDays(localToday, -1), SUMMARY_GENERATION_HOURS[SUMMARY_GENERATION_HOURS.length - 1], SUMMARY_TIME_ZONE)
      : todaySlots[nextSlotIndex - 1];

    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString()
    };
  }

  const tomorrow = addCalendarDays(localToday, 1);
  const periodStart = createZonedSlotDate(localToday, SUMMARY_GENERATION_HOURS[SUMMARY_GENERATION_HOURS.length - 1], SUMMARY_TIME_ZONE);
  const periodEnd = createZonedSlotDate(tomorrow, SUMMARY_GENERATION_HOURS[0], SUMMARY_TIME_ZONE);

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString()
  };
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

  attemptedPrewarmArticleIdsByWindow.forEach((attemptedIds, windowEnd) => {
    if (!retainedWindowEnds.has(windowEnd)) {
      attemptedPrewarmArticleIdsByWindow.delete(windowEnd);
      removedCount += attemptedIds?.size || 0;
    }
  });

  return { removedCount, retainedWindowEnds };
}

function buildSummaryId(topicKey, periodStart, periodEnd) {
  return [topicKey, periodStart, periodEnd]
    .join(':')
    .replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function buildPodcastSummaryId(periodStart, periodEnd) {
  return buildSummaryId('podcast', periodStart, periodEnd);
}

function isTerminalSummary(summary = {}) {
  return Boolean(summary) && TERMINAL_SUMMARY_STATUSES.has(summary.status);
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

  if (NON_RETRYABLE_SUMMARY_FAILURE_CATEGORIES.has(summary.failureCategory)) {
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
  const titleEn = `No ${topicConfig.label} stories`;
  const titleIt = 'Nessuna notizia per questo topic';
  const textEn = `No ${topicConfig.label.toLowerCase()} stories were available for this summary window.`;
  const textIt = 'Nessuna notizia disponibile per questo topic in questa finestra di riepilogo.';

  return {
    id: buildSummaryId(topicConfig.key, window.periodStart, window.periodEnd),
    topicKey: topicConfig.key,
    topicLabel: topicConfig.label,
    topics: topicConfig.topics,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    title: titleEn,
    summaryText: textEn,
    titleByLocale: { en: titleEn, it: titleIt },
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

function getCachedReaderText(articleId) {
  const cached = database.getReaderCache(articleId, null);
  if (!isUsefulReaderText(cached?.contentText)) {
    return '';
  }

  return normalizeReaderText(cached.contentText).slice(0, SUMMARY_READER_TEXT_MAX_CHARS);
}

function withCachedReaderText(articles = []) {
  return articles.map((article) => ({
    ...article,
    readerText: getCachedReaderText(article.id),
    readerTextMaxChars: SUMMARY_READER_TEXT_MAX_CHARS
  }));
}

function getCandidateArticlesForWindow(window) {
  const byId = new Map();
  SUMMARY_TOPICS.forEach((topicConfig) => {
    filterNewsworthySummaryArticles(database.getArticlesForThematicSummary({
      topics: topicConfig.topics,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
      limit: SUMMARY_MAX_ARTICLES_PER_TOPIC
    })).forEach((article) => {
      if (article?.id && !byId.has(article.id)) {
        byId.set(article.id, article);
      }
    });
  });

  return [...byId.values()];
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
  return {
    en: String(summaryTextByLocale.en || summary.summaryText || '').trim(),
    it: String(summaryTextByLocale.it || summaryTextByLocale.en || summary.summaryText || '').trim()
  };
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

function isSamePodcastAudioConfig(summary = {}, ttsConfig = {}, expectedVoice = '') {
  return summary.audioModel === ttsConfig.model && summary.audioVoice === expectedVoice;
}

function shouldRetryPodcastAudio(summary = {}, options = {}) {
  if (summary.status !== 'completed') {
    return false;
  }

  if (!getPodcastScriptTextByLocale(summary).it) {
    return false;
  }

  const ttsConfig = aiPodcastGenerator._getTtsConfig();
  if (!ttsConfig.enabled) {
    logger.info(`AI podcast audio retry skipped: reason=${ttsConfig.apiKey ? 'disabled' : 'missing_api_key'}, windowEnd=${summary.periodEnd}`);
    return false;
  }

  const expectedVoice = aiPodcastGenerator._getTtsVoice();
  const sameAudioConfig = isSamePodcastAudioConfig(summary, ttsConfig, expectedVoice);
  const audioMatchesConfig = summary.audioStatus === 'completed'
    && summary.audioModel === ttsConfig.model
    && summary.audioVoice === expectedVoice;
  if (audioMatchesConfig) {
    return false;
  }

  if (summary.audioStatus === 'failed' && sameAudioConfig && !isPodcastAudioRetryDue(summary, options)) {
    logger.debug(`AI podcast audio retry skipped during cooldown: windowEnd=${summary.periodEnd}`);
    return false;
  }

  return true;
}

async function retryPodcastAudio(summary = {}, options = {}) {
  if (!shouldRetryPodcastAudio(summary, options)) {
    return { summary, generatedNow: false };
  }

  const scriptTextByLocale = getPodcastScriptTextByLocale(summary);
  const ttsConfig = aiPodcastGenerator._getTtsConfig();
  const expectedVoice = aiPodcastGenerator._getTtsVoice();
  const sameAudioConfig = isSamePodcastAudioConfig(summary, ttsConfig, expectedVoice);
  const currentAudioRetryCount = sameAudioConfig ? Math.max(0, Number(summary.audioRetryCount) || 0) : 0;
  const generatingSummary = database.upsertPodcastSummary(buildPodcastUpdatePayload(summary, {
    audioStatus: 'generating',
    audioErrorMessage: '',
    audioFailureCategory: '',
    audioModel: ttsConfig.model,
    audioVoice: expectedVoice,
    audioRetryCount: currentAudioRetryCount,
    audioFailedAt: summary.audioFailedAt || null,
    status: 'completed'
  }));
  broadcastSummariesRefresh(options);

  try {
    const audio = await aiPodcastGenerator.generateItalianAudio(scriptTextByLocale.it);
    if (!audio) {
      const unavailableSummary = database.upsertPodcastSummary(buildPodcastUpdatePayload(generatingSummary, {
        audioStatus: 'not_available',
        audioErrorMessage: '',
        audioFailureCategory: '',
        audioRetryCount: currentAudioRetryCount,
        audioFailedAt: null,
        audioModel: ttsConfig.model,
        audioVoice: expectedVoice,
        status: 'completed'
      }));
      broadcastSummariesRefresh(options);
      return { summary: unavailableSummary, generatedNow: false };
    }

    return {
      summary: database.upsertPodcastSummary(buildPodcastUpdatePayload(generatingSummary, {
        audio,
        audioStatus: 'completed',
        audioErrorMessage: '',
        audioFailureCategory: '',
        audioModel: audio.model || ttsConfig.model,
        audioVoice: audio.voice || expectedVoice,
        audioRetryCount: 0,
        audioFailedAt: null,
        status: 'completed'
      })),
      generatedNow: true
    };
  } catch (error) {
    const failedAt = new Date().toISOString();
    logger.warn(`AI podcast audio retry failed: windowEnd=${summary.periodEnd}, error=${error.message}`);
    const failedSummary = database.upsertPodcastSummary(buildPodcastUpdatePayload(generatingSummary, {
      audioStatus: 'failed',
      audioErrorMessage: error.message,
      audioFailureCategory: getPodcastAudioFailureCategory(error),
      audioModel: ttsConfig.model,
      audioVoice: expectedVoice,
      audioRetryCount: currentAudioRetryCount + 1,
      audioFailedAt: failedAt,
      status: 'completed'
    }));
    broadcastSummariesRefresh(options);
    return {
      summary: failedSummary,
      generatedNow: false
    };
  }
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
    const attemptedIds = shouldRetainAttempts ? (attemptedPrewarmArticleIdsByWindow.get(window.periodEnd) || new Set()) : new Set();
    const candidates = getCandidateArticlesForWindow(window).filter((article) => {
      return article?.id && !attemptedIds.has(article.id) && !isUsefulReaderText(database.getReaderCache(article.id, null)?.contentText);
    });

    if (candidates.length === 0) {
      return { skipped: false, attemptedCount: 0, window };
    }

    candidates.forEach((article) => attemptedIds.add(article.id));
    if (shouldRetainAttempts) {
      attemptedPrewarmArticleIdsByWindow.set(window.periodEnd, attemptedIds);
    }

    const results = await mapSettledWithConcurrency(candidates, SUMMARY_READER_PREWARM_CONCURRENCY, async (article) => {
      const payload = await readerService.getReaderArticle(article.id, {
        userId: null,
        maxArticleAgeHours: null
      });
      return payload && !payload.fallback && isUsefulReaderText(payload.contentText);
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
  if (isTerminalSummary(existingSummary) && options.force !== true) {
    return { summary: existingSummary, generatedNow: false };
  }
  if (existingSummary?.status === 'failed' && options.force !== true && !isFailedSummaryRetryDue(existingSummary, options.referenceDate || new Date())) {
    logger.debug(`Thematic summary retry skipped during cooldown: topic=${topicConfig.key}, windowEnd=${window.periodEnd}`);
    return { summary: null, generatedNow: false };
  }

  const articles = filterNewsworthySummaryArticles(database.getArticlesForThematicSummary({
    topics: topicConfig.topics,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    limit: SUMMARY_MAX_ARTICLES_PER_TOPIC
  }));

  if (articles.length === 0) {
    if (options.force !== true && database.hasPendingTopicProcessingForThematicSummary?.(window)) {
      return { summary: null, generatedNow: false };
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
        title: generated.title,
        summaryText: generated.summaryText,
        titleByLocale: generated.titleByLocale,
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
      title: topicConfig.label,
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
  if (existingSummary?.status === 'empty' && options.force !== true) {
    return { summary: existingSummary, generatedNow: false };
  }
  if (existingSummary?.status === 'failed' && options.force !== true && !isFailedSummaryRetryDue(existingSummary, options.referenceDate || new Date())) {
    logger.debug(`AI podcast retry skipped during cooldown: windowEnd=${window.periodEnd}`);
    return { summary: null, generatedNow: false };
  }

  const articles = sortArticlesForPodcast(getCandidateArticlesForWindow(window));
  if (articles.length === 0) {
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
    database.upsertPodcastSummary({
      ...basePayload,
      title: 'News podcast',
      scriptText: '',
      titleByLocale: { en: 'News podcast', it: 'Podcast news' },
      scriptTextByLocale: { en: '', it: '' },
      model: aiPodcastGenerator._getScriptConfig().model,
      audioStatus: 'not_available',
      status: 'failed',
      failureCategory,
      retryCount: (existingSummary?.retryCount || 0) + 1,
      errorMessage: error.message
    });
    return { summary: null, generatedNow: false };
  }
}

async function generateDueSummaries(options = {}) {
  if (generationPromise && options.force !== true) {
    return generationPromise;
  }

  generationPromise = (async () => {
    const window = options.window || getLatestDueWindow(options.referenceDate || new Date());
    const summaries = [];
    let generatedCount = 0;
    const canGenerateSummaries = aiSummaryGenerator.isAiSummaryGenerationAvailable();

    for (const topicConfig of SUMMARY_TOPICS) {
      const result = await generateSummaryForTopic(topicConfig, window, { ...options, canGenerateSummaries });
      if (TERMINAL_SUMMARY_STATUSES.has(result.summary?.status)) {
        summaries.push(result.summary);
      }
      if (result.generatedNow) {
        generatedCount += 1;
      }
    }

    const podcastResult = await generatePodcastForWindow(window, options);
    if (podcastResult.summary?.status === 'completed') {
      summaries.unshift(podcastResult.summary);
    }
    if (podcastResult.generatedNow) {
      generatedCount += 1;
    }

    if (generatedCount > 0) {
      logger.info(`Thematic summaries ready: windowEnd=${window.periodEnd}, count=${generatedCount}`);
      broadcastSummariesRefresh(options);
    }

    return {
      window,
      items: summaries
    };
  })().finally(() => {
    generationPromise = null;
  });

  return generationPromise;
}

function getLatestSummaries() {
  const topicConfigs = getSummaryTopics();
  const latestByKey = new Map(
    database.listLatestThematicSummaries(topicConfigs.map((topic) => topic.key)).map((summary) => [summary.topicKey, summary])
  );

  const topicItems = topicConfigs
    .map((topic) => {
      const summary = latestByKey.get(topic.key);
      return summary ? { ...summary, topicLabel: topic.label } : null;
    })
    .filter(Boolean);
  const latestPodcast = database.getLatestPodcastSummary();

  return {
    items: latestPodcast ? [latestPodcast, ...topicItems] : topicItems,
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
  _getNextDueWindow: getNextDueWindow,
  _isReaderPrewarmEnabled: isReaderPrewarmEnabled,
  _getSummaryTimeZone: () => SUMMARY_TIME_ZONE,
  _getSummaryTopics: getSummaryTopics,
  _generatePodcastForWindow: generatePodcastForWindow,
  _isPromotionalDealArticle: isPromotionalDealArticle,
  _getPrewarmAttemptWindowCount: () => attemptedPrewarmArticleIdsByWindow.size,
  _prunePrewarmAttempts: prunePrewarmAttempts
};
