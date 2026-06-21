const { parseIntegerEnv } = require('../utils/env');
const { isOpenRouterFeatureEnabled } = require('../config/aiFeatures');
const {
  estimateTokenCountFromChars,
  extractUsage,
  getChatOutputCharCount,
  getChatPromptCharCount,
  getFinishReason,
  logAiRequestMetric
} = require('../utils/aiMetrics');

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 120000;

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

function getOpenRouterConfig({
  enabledEnvName,
  modelEnvName,
  defaultModel,
  timeoutEnvName,
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  clampTimeout = false
} = {}) {
  const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  const resolvedDefaultModel = String(defaultModel || '').trim();

  return {
    apiKey,
    enabled: isOpenRouterFeatureEnabled(enabledEnvName),
    model: String(process.env[modelEnvName] || resolvedDefaultModel).trim() || resolvedDefaultModel,
    baseUrl: String(process.env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL).trim().replace(/\/+$/u, ''),
    timeoutMs: parseIntegerEnv(timeoutEnvName, defaultTimeoutMs, { min: 1000, max: 120000, clamp: clampTimeout, strict: true })
  };
}

async function createOpenRouterClient(config = {}) {
  const { OpenRouter } = await loadOpenRouterSdk();
  return new OpenRouter({
    apiKey: config.apiKey,
    serverURL: config.baseUrl,
    timeoutMs: config.timeoutMs,
    httpReferer: String(process.env.APP_BASE_URL || 'http://localhost'),
    appTitle: 'News Flow'
  });
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

function parseJsonContent(content) {
  const rawContent = String(content || '').trim();
  if (!rawContent) {
    return null;
  }

  try {
    return JSON.parse(rawContent);
  } catch {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/u);
    if (!jsonMatch) {
      return null;
    }

    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }
}

async function sendChatCompletion(openRouter, chatRequest, options = {}) {
  const completionPromise = openRouter.chat.send({ chatRequest }, {
    retries: { strategy: 'none' },
    timeoutMs: options.timeoutMs
  });

  // The SDK's APIPromise owns a secondary unwrapped promise; attach a catch so
  // expected request failures do not also surface as global unhandled rejections.
  if (completionPromise && typeof completionPromise.catch === 'function') {
    completionPromise.catch(() => {});
  }

  return completionPromise;
}

function buildJsonChatRequest(request = {}) {
  const maxTokens = request.maxTokens ?? request.maxCompletionTokens;

  return {
    ...request,
    maxTokens,
    maxCompletionTokens: request.maxCompletionTokens ?? maxTokens,
    reasoning: {
      enabled: false,
      effort: 'none',
      maxTokens: 0,
      ...(request.reasoning || {})
    },
    responseFormat: request.responseFormat || { type: 'json_object' },
    stream: request.stream ?? false
  };
}

async function sendJsonChatCompletion(openRouter, chatRequest, options = {}) {
  const request = buildJsonChatRequest(chatRequest);
  const startedAt = Date.now();
  const promptChars = getChatPromptCharCount(request);
  const baseMetric = {
    provider: 'openrouter',
    type: 'chat_completion',
    feature: options.metrics?.feature || 'unknown',
    model: request.model || options.metrics?.model,
    promptChars,
    estimatedPromptTokens: estimateTokenCountFromChars(promptChars),
    ...options.metrics
  };

  try {
    const response = await sendChatCompletion(openRouter, request, options);
    const outputChars = getChatOutputCharCount(response);
    const usage = extractUsage(response);

    logAiRequestMetric({
      ...baseMetric,
      status: 'completed',
      durationMs: Date.now() - startedAt,
      outputChars,
      estimatedOutputTokens: estimateTokenCountFromChars(outputChars),
      finishReason: getFinishReason(response),
      ...(usage || {})
    });

    return response;
  } catch (error) {
    logAiRequestMetric({
      ...baseMetric,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      errorName: error?.name || 'Error',
      errorCode: error?.code,
      errorMessage: error?.message
    }, 'warn');
    throw error;
  }
}

module.exports = {
  createOpenRouterClient,
  extractAssistantContent,
  getOpenRouterConfig,
  parseJsonContent,
  sendJsonChatCompletion,
  setOpenRouterSdkLoader
};
