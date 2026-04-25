const logger = require('../utils/logger');
const topicNormalizer = require('./topicNormalizer');

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_OPENROUTER_MODEL = 'qwen/qwen3.5-9b';
const DEFAULT_BATCH_SIZE = 8;
const DEFAULT_BATCH_CONCURRENCY = 1;
const DEFAULT_MAX_ARTICLES_PER_REFRESH = 160;
const DEFAULT_TIMEOUT_MS = 30000;

let openRouterSdkLoader = () => import('@openrouter/sdk');
let openRouterSdkPromise = null;

function setOpenRouterSdkLoader(loader) {
  openRouterSdkLoader = loader || (() => import('@openrouter/sdk'));
  openRouterSdkPromise = null;
}

async function loadOpenRouterSdk() {
  if (!openRouterSdkPromise) {
    openRouterSdkPromise = openRouterSdkLoader();
  }

  return openRouterSdkPromise;
}

async function createOpenRouterClient(config) {
  const { OpenRouter } = await loadOpenRouterSdk();
  return new OpenRouter({
    apiKey: config.apiKey,
    serverURL: config.baseUrl,
    timeoutMs: config.timeoutMs,
    httpReferer: String(process.env.APP_BASE_URL || 'http://localhost'),
    appTitle: 'News Flow'
  });
}

function getIntegerEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(Math.floor(value), max));
}

function getConfig() {
  const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  const enabledValue = String(process.env.AI_TOPIC_DETECTION_ENABLED || 'auto').trim().toLowerCase();

  return {
    apiKey,
    enabled: enabledValue !== 'false' && Boolean(apiKey),
    model: String(process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL).trim() || DEFAULT_OPENROUTER_MODEL,
    baseUrl: String(process.env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL).trim().replace(/\/+$/u, ''),
    batchSize: getIntegerEnv('AI_TOPIC_BATCH_SIZE', DEFAULT_BATCH_SIZE, 1, 50),
    batchConcurrency: getIntegerEnv('AI_TOPIC_BATCH_CONCURRENCY', DEFAULT_BATCH_CONCURRENCY, 1, 4),
    maxArticlesPerRefresh: getIntegerEnv('AI_TOPIC_MAX_ARTICLES_PER_REFRESH', DEFAULT_MAX_ARTICLES_PER_REFRESH, 1, 1000),
    timeoutMs: getIntegerEnv('AI_TOPIC_REQUEST_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 1000, 120000)
  };
}

function chunkItems(items = [], size = DEFAULT_BATCH_SIZE) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function mapWithConcurrency(items = [], concurrency = DEFAULT_BATCH_CONCURRENCY, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      } catch (error) {
        logger.warn(`AI topic batch failed: ${summarizeAiError(error)}`);
        results[currentIndex] = new Map();
      }
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function isTimeoutError(error) {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return name.includes('timeout') || message.includes('aborted due to timeout') || message.includes('timeout');
}

function summarizeAiError(error) {
  if (isTimeoutError(error)) {
    return 'OpenRouter request timed out; keeping local fallback topics';
  }

  return error?.message || 'OpenRouter request failed; keeping local fallback topics';
}

function truncateText(value, maxLength) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function buildArticlePayload(article = {}) {
  return {
    id: String(article.id || '').trim(),
    source: truncateText(article.source || article.rawSource || '', 80),
    title: truncateText(article.title || '', 220),
    description: truncateText(article.description || '', 420)
  };
}

function buildPrompt(batch = []) {
  return [
    'Classify each news item into one to three canonical topics when the title or description is enough to decide.',
    `Allowed topics: ${topicNormalizer.CANONICAL_TOPICS.join(', ')}.`,
    'Use the exact allowed Italian topic labels only.',
    'Use only the title, short description, and source. Do not use provider RSS categories and do not infer from missing full article content.',
    'Return strict JSON only with this shape: {"topicsById":[{"id":"article-id","topics":["Topic"]}]}',
    'Return one object for every provided id. If truly impossible to classify an item, return an empty topics array for that item.',
    '',
    JSON.stringify({ articles: batch.map(buildArticlePayload) })
  ].join('\n');
}

function parseJsonContent(content) {
  const rawContent = String(content || '').trim();
  if (!rawContent) {
    return null;
  }

  try {
    return JSON.parse(rawContent);
  } catch {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/u);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  }
}

function getClassifierEntries(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  return [
    payload?.topicsById,
    payload?.results,
    payload?.classifications,
    payload?.articles,
    payload?.items
  ].find(Array.isArray) || [];
}

function getClassifierEntryId(entry = {}) {
  return String(entry.id || entry.articleId || entry.article_id || '').trim();
}

function getClassifierEntryTopics(entry = {}) {
  if (Array.isArray(entry.topics)) {
    return entry.topics;
  }

  if (Array.isArray(entry.categories)) {
    return entry.categories;
  }

  if (entry.topic) {
    return [entry.topic];
  }

  if (entry.category) {
    return [entry.category];
  }

  return [];
}

function summarizeClassifierResult(payload, allowedIds = new Set()) {
  if (!payload || typeof payload !== 'object') {
    return 'invalid_json';
  }

  const entries = getClassifierEntries(payload);
  if (entries.length === 0) {
    return 'missing_topics_array';
  }

  const validIdEntries = entries.filter((entry) => allowedIds.has(getClassifierEntryId(entry)));
  if (validIdEntries.length === 0) {
    return `no_matching_article_ids entries=${entries.length}`;
  }

  const topicEntries = validIdEntries.filter((entry) => getClassifierEntryTopics(entry).length > 0);
  if (topicEntries.length === 0) {
    return `empty_topics entries=${entries.length} validIds=${validIdEntries.length}`;
  }

  return `unsupported_topics entries=${entries.length} validIds=${validIdEntries.length}`;
}

function normalizeClassifierResult(payload, allowedIds = new Set()) {
  const entries = getClassifierEntries(payload);
  const result = new Map();

  entries.forEach((entry) => {
    const id = getClassifierEntryId(entry);
    if (!id || !allowedIds.has(id)) {
      return;
    }

    const topics = topicNormalizer.limitTopics(getClassifierEntryTopics(entry), 3);
    if (topics.length > 0) {
      result.set(id, topics);
    }
  });

  return result;
}

function extractContentPart(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(extractContentPart).filter(Boolean).join('\n');
  }

  if (typeof value === 'object') {
    return extractContentPart(value.text || value.content || value.outputText || value.output_text);
  }

  return '';
}

function extractAssistantContent(response = {}) {
  const choice = response.choices?.[0] || {};
  return extractContentPart(
    choice.message?.content
      || choice.message?.text
      || choice.text
      || response.outputText
      || response.output_text
      || response.message?.content
      || response.content
  );
}

function summarizeResponseShape(response = {}) {
  const choice = response.choices?.[0] || {};
  const message = choice.message || {};
  const messageKeys = Object.keys(message).sort().join(',') || 'none';
  const contentType = Array.isArray(message.content) ? 'array' : typeof message.content;
  const finishReason = choice.finishReason || choice.finish_reason || 'unknown';
  const reasoningChars = String(message.reasoning || '').length;
  const refusalChars = String(message.refusal || '').length;

  return `finishReason=${finishReason}, messageKeys=${messageKeys}, contentType=${contentType}, reasoningChars=${reasoningChars}, refusalChars=${refusalChars}`;
}

async function classifyBatch(batch, config) {
  const allowedIds = new Set(batch.map((article) => article.id).filter(Boolean));
  if (allowedIds.size === 0) {
    return new Map();
  }

  const startedAt = Date.now();
  const openRouter = await createOpenRouterClient(config);
  const completionPromise = openRouter.chat.send({
    chatRequest: {
      model: config.model,
      messages: [
        {
          role: 'system',
          content: 'You are a fast, conservative news taxonomy classifier. Return valid JSON only.'
        },
        {
          role: 'user',
          content: buildPrompt(batch)
        }
      ],
      temperature: 0,
      maxTokens: Math.min(2000, 220 + (batch.length * 48)),
      maxCompletionTokens: Math.min(2000, 220 + (batch.length * 48)),
      reasoning: {
        enabled: false,
        effort: 'none',
        maxTokens: 0
      },
      responseFormat: { type: 'json_object' },
      stream: false
    }
  }, {
    retries: { strategy: 'none' },
    timeoutMs: config.timeoutMs
  });

  // The SDK's APIPromise owns a secondary unwrapped promise; attach a catch so
  // expected request failures do not also surface as global unhandled rejections.
  if (completionPromise && typeof completionPromise.catch === 'function') {
    completionPromise.catch(() => {});
  }

  const response = await completionPromise;

  const content = extractAssistantContent(response);
  const payload = parseJsonContent(content);
  const result = normalizeClassifierResult(payload, allowedIds);

  if (result.size === 0) {
    logger.warn(`AI topic batch produced no valid topics: reason=${summarizeClassifierResult(payload, allowedIds)}, responseChars=${content.length}, ${summarizeResponseShape(response)}`);
  }

  logger.info(`AI topic batch completed: model=${config.model}, articles=${batch.length}, classified=${result.size}, durationMs=${Date.now() - startedAt}`);
  return result;
}

async function classifyTopicsForArticles(articles = []) {
  const config = getConfig();
  if (!Array.isArray(articles) || articles.length === 0) {
    return new Map();
  }

  if (!config.enabled) {
    logger.info(`AI topic detection skipped: reason=${config.apiKey ? 'disabled' : 'missing_api_key'}, articles=${articles.length}`);
    return new Map();
  }

  const startedAt = Date.now();
  const limitedArticles = articles.slice(0, config.maxArticlesPerRefresh);
  if (articles.length > limitedArticles.length) {
    logger.warn(`AI topic detection capped at ${limitedArticles.length}/${articles.length} new articles for this refresh`);
  }

  const batches = chunkItems(limitedArticles, config.batchSize);
  logger.info(`AI topic detection started: model=${config.model}, articles=${limitedArticles.length}, batches=${batches.length}`);
  const batchResults = await mapWithConcurrency(batches, config.batchConcurrency, (batch) => classifyBatch(batch, config));
  const result = new Map();

  batchResults.forEach((batchResult) => {
    batchResult.forEach((topics, articleId) => {
      result.set(articleId, topics);
    });
  });

  logger.info(`AI topic detection completed: model=${config.model}, requested=${limitedArticles.length}, classified=${result.size}, durationMs=${Date.now() - startedAt}`);
  return result;
}

module.exports = {
  classifyTopicsForArticles,
  _buildArticlePayload: buildArticlePayload,
  _buildPrompt: buildPrompt,
  _getConfig: getConfig,
  _extractAssistantContent: extractAssistantContent,
  _normalizeClassifierResult: normalizeClassifierResult,
  _parseJsonContent: parseJsonContent,
  _summarizeResponseShape: summarizeResponseShape,
  _setOpenRouterSdkLoader: setOpenRouterSdkLoader
};
