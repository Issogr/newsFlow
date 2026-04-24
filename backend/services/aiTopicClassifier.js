const axios = require('axios');
const logger = require('../utils/logger');
const topicNormalizer = require('./topicNormalizer');

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_OPENROUTER_MODEL = 'liquid/lfm-2.5-1.2b-instruct:free';
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_BATCH_CONCURRENCY = 2;
const DEFAULT_MAX_ARTICLES_PER_REFRESH = 160;
const DEFAULT_TIMEOUT_MS = 10000;

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
    timeoutMs: getIntegerEnv('AI_TOPIC_REQUEST_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 1000, 30000)
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
        logger.warn(`AI topic batch failed: ${error.message}`);
        results[currentIndex] = new Map();
      }
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
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
    'Classify each news item into zero to three canonical topics.',
    `Allowed topics: ${topicNormalizer.CANONICAL_TOPICS.join(', ')}.`,
    'Use only the title, short description, and source. Do not use provider RSS categories and do not infer from missing full article content.',
    'Return strict JSON only with this shape: {"topicsById":[{"id":"article-id","topics":["Topic"]}]}',
    'If unsure, return an empty topics array for that item.',
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

function normalizeClassifierResult(payload, allowedIds = new Set()) {
  const entries = Array.isArray(payload?.topicsById) ? payload.topicsById : [];
  const result = new Map();

  entries.forEach((entry) => {
    const id = String(entry?.id || '').trim();
    if (!id || !allowedIds.has(id)) {
      return;
    }

    const topics = topicNormalizer.limitTopics(Array.isArray(entry.topics) ? entry.topics : [], 3);
    result.set(id, topics);
  });

  return result;
}

async function classifyBatch(batch, config) {
  const allowedIds = new Set(batch.map((article) => article.id).filter(Boolean));
  if (allowedIds.size === 0) {
    return new Map();
  }

  const response = await axios.post(`${config.baseUrl}/chat/completions`, {
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
    max_tokens: Math.min(2000, 160 + (batch.length * 36))
  }, {
    timeout: config.timeoutMs,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': String(process.env.APP_BASE_URL || 'http://localhost'),
      'X-Title': 'News Flow'
    },
    validateStatus: (status) => status >= 200 && status < 300
  });

  const content = response.data?.choices?.[0]?.message?.content;
  return normalizeClassifierResult(parseJsonContent(content), allowedIds);
}

async function classifyTopicsForArticles(articles = []) {
  const config = getConfig();
  if (!config.enabled || !Array.isArray(articles) || articles.length === 0) {
    return new Map();
  }

  const limitedArticles = articles.slice(0, config.maxArticlesPerRefresh);
  if (articles.length > limitedArticles.length) {
    logger.warn(`AI topic detection capped at ${limitedArticles.length}/${articles.length} new articles for this refresh`);
  }

  const batches = chunkItems(limitedArticles, config.batchSize);
  const batchResults = await mapWithConcurrency(batches, config.batchConcurrency, (batch) => classifyBatch(batch, config));
  const result = new Map();

  batchResults.forEach((batchResult) => {
    batchResult.forEach((topics, articleId) => {
      result.set(articleId, topics);
    });
  });

  return result;
}

module.exports = {
  classifyTopicsForArticles,
  _buildArticlePayload: buildArticlePayload,
  _buildPrompt: buildPrompt,
  _getConfig: getConfig,
  _normalizeClassifierResult: normalizeClassifierResult,
  _parseJsonContent: parseJsonContent
};
