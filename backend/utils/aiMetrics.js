const logger = require('./logger');
const { redactSecretsForLog } = require('./logRedaction');
const summarizeErrorMessage = require('./summarizeError');

function safeNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function estimateTokenCountFromChars(charCount = 0) {
  return Math.ceil(Math.max(0, safeNumber(charCount)) / 4);
}

function getContentLength(value) {
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
    return getContentLength(value.text || value.content || value.outputText || value.output_text || '');
  }

  return String(value).length;
}

function getChatPromptCharCount(chatRequest = {}) {
  return (Array.isArray(chatRequest.messages) ? chatRequest.messages : [])
    .reduce((total, message) => total + getContentLength(message?.content), 0);
}

function getChatOutputCharCount(response = {}) {
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

function getUsageValue(usage = {}, ...keys) {
  const key = keys.find((candidate) => {
    const value = usage?.[candidate];
    return value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value));
  });
  return key ? Number(usage[key]) : null;
}

function getUsageObject(usage = {}, ...keys) {
  const key = keys.find((candidate) => usage?.[candidate] && typeof usage[candidate] === 'object');
  return key ? usage[key] : {};
}

function getUsageBoolean(usage = {}, ...keys) {
  const key = keys.find((candidate) => typeof usage?.[candidate] === 'boolean');
  return key ? usage[key] : null;
}

function extractUsage(response = {}) {
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

function getFinishReason(response = {}) {
  const choice = response.choices?.[0] || {};
  return String(choice.finishReason || choice.finish_reason || '').trim() || null;
}

function logAiRequestMetric(metric = {}, level = 'info') {
  const safeMetric = metric.errorMessage ? {
    ...metric,
    errorMessage: summarizeErrorMessage({
      message: redactSecretsForLog(metric.errorMessage, { redactAllQuery: true })
    })
  } : metric;
  const sanitizedMetric = Object.fromEntries(Object.entries(safeMetric)
    .filter(([, value]) => value !== undefined && value !== null && value !== ''));
  const logLevel = typeof logger[level] === 'function' ? level : 'info';

  logger[logLevel]('AI request metric', sanitizedMetric);
}

module.exports = {
  estimateTokenCountFromChars,
  extractUsage,
  getChatOutputCharCount,
  getChatPromptCharCount,
  getFinishReason,
  logAiRequestMetric
};
