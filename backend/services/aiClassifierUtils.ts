const { mapSettledWithConcurrency } = require('../utils/concurrency');
const { isAiToggleEnabled } = require('../config/aiFeatures');
const { parseIntegerEnv } = require('../utils/env');
const { createOpenRouterClient } = require('./openRouterClient');
import type winston from 'winston';
import type { DynamicRecord, NewsArticle } from '../utils/types';

function getClassifierBatchConfig() {
  return {
    batchSize: parseIntegerEnv('AI_TOPIC_BATCH_SIZE', 10, { min: 1, max: 50, clamp: true, strict: true }),
    batchConcurrency: parseIntegerEnv('AI_TOPIC_BATCH_CONCURRENCY', 1, { min: 1, max: 4, clamp: true, strict: true }),
    maxArticlesPerRefresh: parseIntegerEnv('AI_TOPIC_MAX_ARTICLES_PER_REFRESH', 160, { min: 1, max: 1000, clamp: true, strict: true }),
    deterministicSkipEnabled: isAiToggleEnabled('AI_TOPIC_DETERMINISTIC_SKIP_ENABLED')
  };
}

function chunkItems<T>(items: T[] = [], size = 1) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isTimeoutError(error: unknown) {
  const name = String(error instanceof Error ? error.name : '').toLowerCase();
  const message = String(error instanceof Error ? error.message : '').toLowerCase();
  return name.includes('timeout') || message.includes('aborted due to timeout') || message.includes('timeout');
}

function getClassifierEntryId(entry: DynamicRecord = {}) {
  return String(entry.id || entry.articleId || entry.article_id || '').trim();
}

function getClassifierEntryRef(entry: DynamicRecord = {}) {
  const rawRef = entry.ref ?? entry.articleRef ?? entry.article_ref ?? entry.index;
  return String(rawRef || '').trim();
}

function resolveClassifierEntryId(entry: DynamicRecord = {}, allowedIds = new Set<string>(), refToArticleId: Map<string, string> | null = null) {
  const id = getClassifierEntryId(entry);
  if (id && allowedIds.has(id)) {
    return id;
  }

  const ref = getClassifierEntryRef(entry);
  const mappedId = refToArticleId?.get(ref);
  return mappedId && allowedIds.has(mappedId) ? mappedId : '';
}

function getClassifierEntries(payload: unknown, preferredKeys: string[] = []): DynamicRecord[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = payload && typeof payload === 'object' ? payload as DynamicRecord : {};
  return [
    ...preferredKeys.map((key) => record[key]),
    record.results,
    record.classifications,
    record.articles,
    record.items
  ].find(Array.isArray) || [];
}

function summarizeResponseShape(response: DynamicRecord = {}, options: { includeReasoningStats?: boolean } = {}) {
  const choices = Array.isArray(response.choices) ? response.choices as DynamicRecord[] : [];
  const choice = choices[0] || {};
  const message = choice.message && typeof choice.message === 'object' ? choice.message as DynamicRecord : {};
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

interface ClassifierConfig extends DynamicRecord {
  apiKey?: string;
  batchConcurrency: number;
  batchSize: number;
  enabled: boolean;
  maxArticlesPerRefresh: number;
  model: string;
}

interface ClassifierSplitResult extends DynamicRecord {
  aiArticles: NewsArticle[];
}

interface RunBatchedClassifierOptions {
  articles?: NewsArticle[];
  config: ClassifierConfig;
  featureName: string;
  splitArticles: (articles: NewsArticle[], config: ClassifierConfig) => ClassifierSplitResult;
  deterministicResultKey: string;
  classifyBatch: (articles: NewsArticle[], config: ClassifierConfig, context: DynamicRecord) => Promise<Map<string, unknown>>;
  summarizeBatchError: (error: unknown) => string;
  logger: winston.Logger;
}

async function runBatchedClassifier({
  articles = [],
  config,
  featureName,
  splitArticles,
  deterministicResultKey,
  classifyBatch,
  summarizeBatchError,
  logger
}: RunBatchedClassifierOptions) {
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
  const aiArticles = splitResult.aiArticles;
  const deterministicResult = splitResult[deterministicResultKey];
  const deterministicResultsByArticleId = deterministicResult instanceof Map ? deterministicResult : new Map<string, unknown>();
  const batches = chunkItems(aiArticles, config.batchSize);
  const openRouter = batches.length > 0 ? await createOpenRouterClient(config) : null;
  logger.info(`AI ${featureName} detection started: model=${config.model}, articles=${limitedArticles.length}, deterministic=${deterministicResultsByArticleId.size}, aiArticles=${aiArticles.length}, batches=${batches.length}`);

  const batchResults: PromiseSettledResult<Map<string, unknown>>[] = await mapSettledWithConcurrency(batches, config.batchConcurrency, (batch: NewsArticle[], batchIndex: number) => classifyBatch(batch, config, {
    batchIndex,
    batchCount: batches.length,
    openRouter
  }));
  const resultByArticleId = new Map<string, unknown>(deterministicResultsByArticleId);
  const failedArticleIds: string[] = [];

  batchResults.forEach((batchResult: PromiseSettledResult<Map<string, unknown>>, index: number) => {
    if (batchResult?.status === 'rejected') {
      logger.warn(`AI ${featureName} batch failed: ${summarizeBatchError(batchResult.reason)}`);
      failedArticleIds.push(...(batches[index] || []).map((article) => article.id).filter(Boolean));
      return;
    }

    batchResult.value.forEach((classification: unknown, articleId: string) => {
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

export = {
  getClassifierBatchConfig,
  getClassifierEntries,
  isTimeoutError,
  resolveClassifierEntryId,
  runBatchedClassifier,
  summarizeResponseShape,
};
