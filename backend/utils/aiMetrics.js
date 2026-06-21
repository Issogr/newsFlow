const logger = require('./logger');

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
  const key = keys.find((candidate) => Number.isFinite(Number(usage?.[candidate])));
  return key ? Number(usage[key]) : null;
}

function extractUsage(response = {}) {
  const usage = response.usage || response.choices?.[0]?.usage || null;
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  return {
    promptTokens: getUsageValue(usage, 'promptTokens', 'prompt_tokens', 'inputTokens', 'input_tokens'),
    completionTokens: getUsageValue(usage, 'completionTokens', 'completion_tokens', 'outputTokens', 'output_tokens'),
    totalTokens: getUsageValue(usage, 'totalTokens', 'total_tokens')
  };
}

function getFinishReason(response = {}) {
  const choice = response.choices?.[0] || {};
  return String(choice.finishReason || choice.finish_reason || '').trim() || null;
}

function logAiRequestMetric(metric = {}, level = 'info') {
  const sanitizedMetric = Object.fromEntries(Object.entries(metric)
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
