import logger from './logger';
import logRedaction from './logRedaction';
import summarizeErrorMessage from './summarizeError';
const { redactSecretsForLog } = logRedaction;
import type { DynamicRecord } from './types';

function safeNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function estimateTokenCountFromChars(charCount = 0) {
  return Math.ceil(Math.max(0, safeNumber(charCount)) / 4);
}

function getUsageValue(value: unknown) {
  return value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value))
    ? Number(value)
    : null;
}

function getUsageObject(value: unknown): DynamicRecord {
  return value && typeof value === 'object' ? value as DynamicRecord : {};
}

function extractUsage(response: { usage?: DynamicRecord } = {}) {
  const usage = response.usage;
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const promptDetails = getUsageObject(usage.prompt_tokens_details);
  const completionDetails = getUsageObject(usage.completion_tokens_details);
  const costDetails = getUsageObject(usage.cost_details);

  return {
    promptTokens: getUsageValue(usage.prompt_tokens),
    completionTokens: getUsageValue(usage.completion_tokens),
    totalTokens: getUsageValue(usage.total_tokens),
    cachedPromptTokens: getUsageValue(promptDetails.cached_tokens),
    cacheWritePromptTokens: getUsageValue(promptDetails.cache_write_tokens),
    reasoningTokens: getUsageValue(completionDetails.reasoning_tokens),
    cost: getUsageValue(usage.cost),
    isByok: typeof usage.is_byok === 'boolean' ? usage.is_byok : null,
    upstreamInferenceCost: getUsageValue(costDetails.upstream_inference_cost),
    upstreamInferencePromptCost: getUsageValue(costDetails.upstream_inference_prompt_cost),
    upstreamInferenceCompletionsCost: getUsageValue(costDetails.upstream_inference_completions_cost)
  };
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
  const logLevel = ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info';

  logger.log(logLevel, 'AI request metric', sanitizedMetric);
}

export default {
  estimateTokenCountFromChars,
  extractUsage,
  logAiRequestMetric
};
