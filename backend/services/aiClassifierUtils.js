const { mapSettledWithConcurrency } = require('../utils/concurrency');
const { createOpenRouterClient } = require('./openRouterClient');

function chunkItems(items = [], size = 1) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isTimeoutError(error) {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return name.includes('timeout') || message.includes('aborted due to timeout') || message.includes('timeout');
}

function getClassifierEntryId(entry = {}) {
  return String(entry.id || entry.articleId || entry.article_id || '').trim();
}

function getClassifierEntryRef(entry = {}) {
  const rawRef = entry.ref ?? entry.articleRef ?? entry.article_ref ?? entry.index;
  return String(rawRef || '').trim();
}

function resolveClassifierEntryId(entry = {}, allowedIds = new Set(), refToArticleId = null) {
  const id = getClassifierEntryId(entry);
  if (id && allowedIds.has(id)) {
    return id;
  }

  const ref = getClassifierEntryRef(entry);
  const mappedId = refToArticleId?.get(ref);
  return mappedId && allowedIds.has(mappedId) ? mappedId : '';
}

function summarizeResponseShape(response = {}, options = {}) {
  const choice = response.choices?.[0] || {};
  const message = choice.message || {};
  const messageKeys = Object.keys(message).sort().join(',') || 'none';
  const contentType = Array.isArray(message.content) ? 'array' : typeof message.content;
  const finishReason = choice.finishReason || choice.finish_reason || 'unknown';
  const baseSummary = `finishReason=${finishReason}, messageKeys=${messageKeys}, contentType=${contentType}`;

  if (!options.includeReasoningStats) {
    return baseSummary;
  }

  const reasoningChars = String(message.reasoning || '').length;
  const refusalChars = String(message.refusal || '').length;
  return `${baseSummary}, reasoningChars=${reasoningChars}, refusalChars=${refusalChars}`;
}

async function runBatchedClassifier({
  articles = [],
  config = {},
  featureName,
  splitArticles,
  deterministicResultKey,
  classifyBatch,
  summarizeBatchError,
  logger
} = {}) {
  if (!Array.isArray(articles) || articles.length === 0) {
    return {
      resultByArticleId: new Map(),
      attemptedArticleIds: [],
      failedArticleIds: [],
      cappedArticleIds: []
    };
  }

  if (!config.enabled) {
    logger.info(`AI ${featureName} detection skipped: reason=${config.apiKey ? 'disabled' : 'missing_api_key'}, articles=${articles.length}`);
    return {
      resultByArticleId: new Map(),
      attemptedArticleIds: [],
      failedArticleIds: [],
      cappedArticleIds: articles.map((article) => article?.id).filter(Boolean)
    };
  }

  const startedAt = Date.now();
  const limitedArticles = articles.slice(0, config.maxArticlesPerRefresh);
  const cappedArticleIds = articles.slice(config.maxArticlesPerRefresh).map((article) => article?.id).filter(Boolean);
  if (articles.length > limitedArticles.length) {
    logger.warn(`AI ${featureName} detection capped at ${limitedArticles.length}/${articles.length} new articles for this refresh`);
  }

  const splitResult = splitArticles(limitedArticles, config);
  const aiArticles = splitResult.aiArticles || [];
  const deterministicResultsByArticleId = splitResult[deterministicResultKey] || new Map();
  const batches = chunkItems(aiArticles, config.batchSize);
  const openRouter = batches.length > 0 ? await createOpenRouterClient(config) : null;
  logger.info(`AI ${featureName} detection started: model=${config.model}, articles=${limitedArticles.length}, deterministic=${deterministicResultsByArticleId.size}, aiArticles=${aiArticles.length}, batches=${batches.length}`);

  const batchResults = await mapSettledWithConcurrency(batches, config.batchConcurrency, (batch, batchIndex) => classifyBatch(batch, config, {
    batchIndex,
    batchCount: batches.length,
    openRouter
  }));
  const resultByArticleId = new Map(deterministicResultsByArticleId);
  const failedArticleIds = [];

  batchResults.forEach((batchResult, index) => {
    if (batchResult?.status === 'rejected') {
      logger.warn(`AI ${featureName} batch failed: ${summarizeBatchError(batchResult.reason)}`);
      failedArticleIds.push(...batches[index].map((article) => article?.id).filter(Boolean));
      return;
    }

    batchResult.value.forEach((classification, articleId) => {
      resultByArticleId.set(articleId, classification);
    });
  });

  logger.info(`AI ${featureName} detection completed: model=${config.model}, requested=${limitedArticles.length}, deterministic=${deterministicResultsByArticleId.size}, aiRequested=${aiArticles.length}, classified=${resultByArticleId.size}, durationMs=${Date.now() - startedAt}`);

  return {
    resultByArticleId,
    attemptedArticleIds: limitedArticles.map((article) => article?.id).filter(Boolean),
    failedArticleIds,
    cappedArticleIds
  };
}

module.exports = {
  chunkItems,
  isTimeoutError,
  resolveClassifierEntryId,
  runBatchedClassifier,
  summarizeResponseShape,
};
