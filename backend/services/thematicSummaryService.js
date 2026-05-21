const database = require('./database');
const logger = require('../utils/logger');
const aiSummaryGenerator = require('./aiSummaryGenerator');
const readerService = require('./readerService');
const websocketService = require('./websocketService');
const { parseIntegerEnv } = require('../utils/env');
const { mapSettledWithConcurrency } = require('../utils/concurrency');

const SUMMARY_GENERATION_HOURS = [7, 13, 19];
const SUMMARY_CHECK_INTERVAL_MS = parseIntegerEnv('THEMATIC_SUMMARY_CHECK_INTERVAL_MS', 60 * 1000, { min: 1000 });
const SUMMARY_MAX_ARTICLES_PER_TOPIC = parseIntegerEnv('AI_SUMMARY_MAX_ARTICLES_PER_TOPIC', 120, { min: 1, max: 300 });
const SUMMARY_READER_PREWARM_MINUTES_BEFORE = parseIntegerEnv('AI_SUMMARY_READER_PREWARM_MINUTES_BEFORE', 30, { min: 1, max: 180 });
const SUMMARY_READER_PREWARM_CONCURRENCY = parseIntegerEnv('AI_SUMMARY_READER_PREWARM_CONCURRENCY', 2, { min: 1, max: 8 });
const SUMMARY_READER_TEXT_MAX_CHARS = parseIntegerEnv('AI_SUMMARY_READER_TEXT_MAX_CHARS', 3000, { min: 500, max: 12000 });
const SUMMARY_READER_TEXT_MIN_CHARS = parseIntegerEnv('AI_SUMMARY_READER_TEXT_MIN_CHARS', 250, { min: 80, max: 2000 });

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

function isReaderPrewarmEnabled() {
  const enabledValue = String(process.env.AI_SUMMARY_READER_PREWARM_ENABLED || 'auto').trim().toLowerCase();
  return enabledValue !== 'false' && aiSummaryGenerator.isAiSummaryGenerationAvailable();
}

function createLocalSlotDate(referenceDate, hour) {
  const slotDate = new Date(referenceDate);
  slotDate.setHours(hour, 0, 0, 0);
  return slotDate;
}

function getLatestDueWindow(referenceDate = new Date()) {
  const reference = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const todaySlots = SUMMARY_GENERATION_HOURS.map((hour) => createLocalSlotDate(reference, hour));
  const dueSlotIndex = todaySlots.findLastIndex((slotDate) => slotDate.getTime() <= reference.getTime());

  if (dueSlotIndex >= 0) {
    const periodEnd = todaySlots[dueSlotIndex];
    const periodStart = dueSlotIndex === 0
      ? createLocalSlotDate(new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000), SUMMARY_GENERATION_HOURS[SUMMARY_GENERATION_HOURS.length - 1])
      : todaySlots[dueSlotIndex - 1];

    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString()
    };
  }

  const yesterday = new Date(reference.getTime() - 24 * 60 * 60 * 1000);
  const periodEnd = createLocalSlotDate(yesterday, SUMMARY_GENERATION_HOURS[SUMMARY_GENERATION_HOURS.length - 1]);
  const periodStart = createLocalSlotDate(yesterday, SUMMARY_GENERATION_HOURS[SUMMARY_GENERATION_HOURS.length - 2]);

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString()
  };
}

function getNextDueWindow(referenceDate = new Date()) {
  const reference = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const todaySlots = SUMMARY_GENERATION_HOURS.map((hour) => createLocalSlotDate(reference, hour));
  const nextSlotIndex = todaySlots.findIndex((slotDate) => slotDate.getTime() > reference.getTime());

  if (nextSlotIndex >= 0) {
    const periodEnd = todaySlots[nextSlotIndex];
    const periodStart = nextSlotIndex === 0
      ? createLocalSlotDate(new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000), SUMMARY_GENERATION_HOURS[SUMMARY_GENERATION_HOURS.length - 1])
      : todaySlots[nextSlotIndex - 1];

    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString()
    };
  }

  const tomorrow = new Date(reference.getTime() + 24 * 60 * 60 * 1000);
  const periodStart = createLocalSlotDate(reference, SUMMARY_GENERATION_HOURS[SUMMARY_GENERATION_HOURS.length - 1]);
  const periodEnd = createLocalSlotDate(tomorrow, SUMMARY_GENERATION_HOURS[0]);

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString()
  };
}

function getSummaryTopics() {
  return SUMMARY_TOPICS.map((topic) => ({ ...topic }));
}

function buildSummaryId(topicKey, periodStart, periodEnd) {
  return [topicKey, periodStart, periodEnd]
    .join(':')
    .replace(/[^a-zA-Z0-9_-]+/g, '-');
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

function normalizeReaderText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isUsefulReaderText(value = '') {
  return normalizeReaderText(value).length >= SUMMARY_READER_TEXT_MIN_CHARS;
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
    database.getArticlesForThematicSummary({
      topics: topicConfig.topics,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
      limit: SUMMARY_MAX_ARTICLES_PER_TOPIC
    }).forEach((article) => {
      if (article?.id && !byId.has(article.id)) {
        byId.set(article.id, article);
      }
    });
  });

  return [...byId.values()];
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

    const attemptedIds = attemptedPrewarmArticleIdsByWindow.get(window.periodEnd) || new Set();
    const candidates = getCandidateArticlesForWindow(window).filter((article) => {
      return article?.id && !attemptedIds.has(article.id) && !isUsefulReaderText(database.getReaderCache(article.id, null)?.contentText);
    });

    if (candidates.length === 0) {
      return { skipped: false, attemptedCount: 0, window };
    }

    candidates.forEach((article) => attemptedIds.add(article.id));
    attemptedPrewarmArticleIdsByWindow.set(window.periodEnd, attemptedIds);

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
  if (existingSummary && options.force !== true) {
    return existingSummary;
  }

  const articles = database.getArticlesForThematicSummary({
    topics: topicConfig.topics,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    limit: SUMMARY_MAX_ARTICLES_PER_TOPIC
  });

  if (articles.length === 0) {
    return null;
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
      return null;
    }

    return database.upsertThematicSummary({
      ...basePayload,
      title: generated.title,
      summaryText: generated.summaryText,
      titleByLocale: generated.titleByLocale,
      summaryTextByLocale: generated.summaryTextByLocale,
      model: generated.model,
      status: 'completed'
    });
  } catch (error) {
    logger.warn(`Thematic summary generation failed: topic=${topicConfig.key}, windowEnd=${window.periodEnd}, error=${error.message}`);
    database.upsertThematicSummary({
      ...basePayload,
      title: topicConfig.label,
      summaryText: '',
      model: aiSummaryGenerator._getConfig().model,
      status: 'failed',
      errorMessage: error.message
    });
    return null;
  }
}

async function generateDueSummaries(options = {}) {
  if (generationPromise && options.force !== true) {
    return generationPromise;
  }

  generationPromise = (async () => {
    const window = options.window || getLatestDueWindow(options.referenceDate || new Date());
    const summaries = [];

    if (!aiSummaryGenerator.isAiSummaryGenerationAvailable()) {
      return {
        window,
        items: summaries
      };
    }

    for (const topicConfig of SUMMARY_TOPICS) {
      const summary = await generateSummaryForTopic(topicConfig, window, options);
      if (summary) {
        summaries.push(summary);
      }
    }

    if (summaries.length > 0) {
      logger.info(`Thematic summaries ready: windowEnd=${window.periodEnd}, count=${summaries.length}`);
      if (options.broadcast !== false) {
        websocketService.broadcastFeedRefresh({ reason: 'summaries' });
      }
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

  return {
    items: topicConfigs
      .map((topic) => {
        const summary = latestByKey.get(topic.key);
        return summary ? { ...summary, topicLabel: topic.label } : null;
      })
      .filter(Boolean),
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
  _getSummaryTopics: getSummaryTopics
};
