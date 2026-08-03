const logger = require('./logger');
const { redactSecretsForLog } = require('./logRedaction');
const summarizeErrorMessage = require('./summarizeError');
import type { DynamicRecord } from './types';

interface AiMessage extends DynamicRecord {
  content?: unknown;
  text?: unknown;
}

interface AiChoice extends DynamicRecord {
  finishReason?: unknown;
  finish_reason?: unknown;
  message?: AiMessage;
  text?: unknown;
  usage?: DynamicRecord;
}

interface AiResponse extends DynamicRecord {
  choices?: AiChoice[];
  content?: unknown;
  message?: AiMessage;
  outputText?: unknown;
  output_text?: unknown;
  usage?: DynamicRecord;
}

function safeNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function estimateTokenCountFromChars(charCount = 0) {
  return Math.ceil(Math.max(0, safeNumber(charCount)) / 4);
}

function getContentLength(value: unknown): number {
  if (!value) {
    return 0;
  }

  if (typeof value === 'string') {
    return value.length;
  }

  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + getContentLength(item), 0);
  }

  if (typeof value === 'object') {
    const record = value as DynamicRecord;
    return getContentLength(record.text || record.content || record.outputText || record.output_text || '');
  }

  return String(value).length;
}

function getChatPromptCharCount(chatRequest: DynamicRecord = {}) {
  return (Array.isArray(chatRequest.messages) ? chatRequest.messages : [])
    .reduce((total, message) => total + getContentLength(message?.content), 0);
}

function getChatOutputCharCount(response: AiResponse = {}) {
  const choice = response.choices?.[0] || {};
  return getContentLength(
    choice.message?.content
      || choice.message?.text
      || choice.text
      || response.outputText
      || response.output_text
      || response.message?.content
      || response.content
  );
}

function getUsageValue(usage: DynamicRecord = {}, ...keys: string[]) {
  const key = keys.find((candidate) => {
    const value = usage?.[candidate];
    return value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value));
  });
  return key ? Number(usage[key]) : null;
}

function getUsageObject(usage: DynamicRecord = {}, ...keys: string[]): DynamicRecord {
  const key = keys.find((candidate) => usage?.[candidate] && typeof usage[candidate] === 'object');
  return key ? usage[key] as DynamicRecord : {};
}

function getUsageBoolean(usage: DynamicRecord = {}, ...keys: string[]) {
  const key = keys.find((candidate) => typeof usage?.[candidate] === 'boolean');
  return key ? usage[key] : null;
}

function extractUsage(response: AiResponse = {}) {
  const usage = response.usage || response.choices?.[0]?.usage || null;
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const promptDetails = getUsageObject(usage, 'promptTokensDetails', 'prompt_tokens_details');
  const completionDetails = getUsageObject(usage, 'completionTokensDetails', 'completion_tokens_details');
  const costDetails = getUsageObject(usage, 'costDetails', 'cost_details');

  return {
    promptTokens: getUsageValue(usage, 'promptTokens', 'prompt_tokens', 'inputTokens', 'input_tokens'),
    completionTokens: getUsageValue(usage, 'completionTokens', 'completion_tokens', 'outputTokens', 'output_tokens'),
    totalTokens: getUsageValue(usage, 'totalTokens', 'total_tokens'),
    cachedPromptTokens: getUsageValue(promptDetails, 'cachedTokens', 'cached_tokens'),
    cacheWritePromptTokens: getUsageValue(promptDetails, 'cacheWriteTokens', 'cache_write_tokens'),
    reasoningTokens: getUsageValue(completionDetails, 'reasoningTokens', 'reasoning_tokens'),
    cost: getUsageValue(usage, 'cost'),
    isByok: getUsageBoolean(usage, 'isByok', 'is_byok'),
    upstreamInferenceCost: getUsageValue(costDetails, 'upstreamInferenceCost', 'upstream_inference_cost'),
    upstreamInferencePromptCost: getUsageValue(costDetails, 'upstreamInferencePromptCost', 'upstream_inference_prompt_cost'),
    upstreamInferenceCompletionsCost: getUsageValue(costDetails, 'upstreamInferenceCompletionsCost', 'upstream_inference_completions_cost')
  };
}

function getFinishReason(response: AiResponse = {}) {
  const choice = response.choices?.[0] || {};
  return String(choice.finishReason || choice.finish_reason || '').trim() || null;
}

function logAiRequestMetric(metric: DynamicRecord = {}, level = 'info') {
  const safeMetric = metric.errorMessage ? {
    ...metric,
    errorMessage: summarizeErrorMessage({
      message: redactSecretsForLog(metric.errorMessage, { redactAllQuery: true })
    })
  } : metric;
  const sanitizedMetric = Object.fromEntries(Object.entries(safeMetric)
    .filter(([, value]) => value !== undefined && value !== null && value !== ''));
  const logLevel = typeof logger[level] === 'function' ? level : 'info';

  logger.log(logLevel, 'AI request metric', sanitizedMetric);
}

export = {
  estimateTokenCountFromChars,
  extractUsage,
  getChatOutputCharCount,
  getChatPromptCharCount,
  getFinishReason,
  logAiRequestMetric
};
