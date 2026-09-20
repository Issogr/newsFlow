const { isAiToggleEnabled } = require('../config/aiFeatures');
const { parseIntegerEnv } = require('../utils/env');
import type { DynamicRecord } from '../utils/types';

function getClassifierBatchConfig() {
  return {
    batchSize: parseIntegerEnv('AI_TOPIC_BATCH_SIZE', 10, { min: 1, max: 50, clamp: true, strict: true }),
    batchConcurrency: parseIntegerEnv('AI_TOPIC_BATCH_CONCURRENCY', 1, { min: 1, max: 4, clamp: true, strict: true }),
    maxArticlesPerRefresh: parseIntegerEnv('AI_TOPIC_MAX_ARTICLES_PER_REFRESH', 160, { min: 1, max: 1000, clamp: true, strict: true }),
    deterministicSkipEnabled: isAiToggleEnabled('AI_TOPIC_DETERMINISTIC_SKIP_ENABLED')
  };
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

export = {
  getClassifierBatchConfig,
  getClassifierEntries,
  isTimeoutError,
  resolveClassifierEntryId,
  summarizeResponseShape,
};
