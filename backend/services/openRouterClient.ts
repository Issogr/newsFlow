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
import type { AppError, DynamicRecord } from '../utils/types';
import type { OpenRouter as OpenRouterSdkClient } from '@openrouter/sdk' with { 'resolution-mode': 'import' };
import type { ChatRequest as OpenRouterChatRequest } from '@openrouter/sdk/models' with { 'resolution-mode': 'import' };

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_FAILURE_BACKOFF_MS = 60 * 1000;
const DEFAULT_FAILURE_MAX_BACKOFF_MS = 15 * 60 * 1000;

type OpenRouterSdkModule = { OpenRouter: typeof OpenRouterSdkClient };
type OpenRouterSdkLoader = () => Promise<OpenRouterSdkModule>;
type OpenRouterClient = InstanceType<typeof OpenRouterSdkClient>;

let openRouterSdkLoader: OpenRouterSdkLoader = async () => await import('@openrouter/sdk');
let openRouterSdkPromise: Promise<OpenRouterSdkModule> | null = null;
const failureBackoffByModel = new Map<string, { failureCount: number; openedAt: number; retryAt: number }>();

function setOpenRouterSdkLoader(loader?: OpenRouterSdkLoader) {
  openRouterSdkLoader = loader || (async () => await import('@openrouter/sdk'));
  openRouterSdkPromise = null;
}

async function loadOpenRouterSdk() {
  if (!openRouterSdkPromise) {
    openRouterSdkPromise = openRouterSdkLoader();
  }

  return openRouterSdkPromise;
}

interface OpenRouterConfigOptions {
  enabledEnvName: string;
  modelEnvName: string;
  defaultModel: string;
  timeoutEnvName: string;
  defaultTimeoutMs?: number;
  clampTimeout?: boolean;
}

interface OpenRouterConfig {
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
  model: string;
  timeoutMs: number;
}

interface HeaderMap extends DynamicRecord {
  get?: (name: string) => unknown;
}

interface OpenRouterErrorRecord {
  code?: unknown;
  error?: {
    code?: unknown;
    metadata?: {
      error_type?: unknown;
      provider_code?: unknown;
    };
  };
  headers?: HeaderMap;
  message?: string;
  name?: string;
  response?: {
    headers?: HeaderMap;
    status?: unknown;
  };
  status?: unknown;
  statusCode?: unknown;
}

interface ChatMessage extends DynamicRecord {
  content?: unknown;
  text?: unknown;
}

interface ChatChoice extends DynamicRecord {
  error?: DynamicRecord;
  message?: ChatMessage;
  text?: unknown;
}

interface ChatResponse extends DynamicRecord {
  choices?: ChatChoice[];
  content?: unknown;
  error?: DynamicRecord;
  id?: unknown;
  message?: ChatMessage;
  model?: unknown;
  outputText?: unknown;
  output_text?: unknown;
  serviceTier?: unknown;
  service_tier?: unknown;
  usage?: DynamicRecord;
}

type ChatRequest = Omit<OpenRouterChatRequest, 'reasoning' | 'stream'> & DynamicRecord & {
  reasoning?: NonNullable<OpenRouterChatRequest['reasoning']> & DynamicRecord;
  stream?: false;
};

interface CompletionOptions extends DynamicRecord {
  metrics?: DynamicRecord;
  timeoutMs?: number;
}

type CompletionError = Omit<AppError, 'code'> & {
  code?: string | number;
  error?: DynamicRecord;
};

function getOpenRouterConfig({
  enabledEnvName,
  modelEnvName,
  defaultModel,
  timeoutEnvName,
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  clampTimeout = false
}: OpenRouterConfigOptions): OpenRouterConfig {
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

async function createOpenRouterClient(config: OpenRouterConfig): Promise<OpenRouterClient> {
  const { OpenRouter } = await loadOpenRouterSdk();
  return new OpenRouter({
    apiKey: config.apiKey,
    serverURL: config.baseUrl,
    timeoutMs: config.timeoutMs,
    httpReferer: String(process.env.APP_BASE_URL || 'http://localhost'),
    appTitle: 'News Flow'
  });
}

function getErrorStatus(error: OpenRouterErrorRecord = {}) {
  const status = Number(error.statusCode ?? error.response?.status ?? error.status);
  return Number.isInteger(status) ? status : null;
}

function getErrorHeader(error: OpenRouterErrorRecord = {}, name = '') {
  const headers = error.headers || error.response?.headers || {};
  if (typeof headers.get === 'function') {
    return headers.get(name);
  }

  const normalizedName = String(name || '').toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === normalizedName);
  return key ? headers[key] : null;
}

function getRetryAfterMs(error: OpenRouterErrorRecord = {}, now = Date.now()) {
  const value = String(getErrorHeader(error, 'retry-after') || '').trim();
  if (!value) {
    return 0;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.ceil(seconds * 1000));
  }

  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : 0;
}

function isTransientOpenRouterError(error: OpenRouterErrorRecord = {}) {
  const status = getErrorStatus(error);
  if ((status !== null && [408, 425, 429].includes(status)) || (status !== null && status >= 500)) {
    return true;
  }
  if (status) {
    return false;
  }

  const signal = `${error.name || ''} ${error.code || ''} ${error.message || ''}`.toLowerCase();
  return /timeout|timed out|abort|network|fetch|connection|econn|socket|enotfound|eai_again/u.test(signal);
}

function shouldBackoffOpenRouterError(error: OpenRouterErrorRecord = {}) {
  const status = getErrorStatus(error);
  if (isTransientOpenRouterError(error) || (status !== null && [401, 402, 404].includes(status))) {
    return true;
  }
  if (status !== 403) {
    return false;
  }

  const signal = `${error.message || ''} ${error.error?.metadata?.error_type || ''} ${error.error?.metadata?.provider_code || ''}`.toLowerCase();
  return !/moderation|guardrail|content[_ -]?filter|policy|blocked/u.test(signal);
}

function getBackoffConfig() {
  return {
    initialMs: parseIntegerEnv('OPENROUTER_FAILURE_BACKOFF_MS', DEFAULT_FAILURE_BACKOFF_MS, { min: 1000, max: 60 * 60 * 1000 }),
    maxMs: parseIntegerEnv('OPENROUTER_FAILURE_MAX_BACKOFF_MS', DEFAULT_FAILURE_MAX_BACKOFF_MS, { min: 1000, max: 24 * 60 * 60 * 1000 })
  };
}

function getBackoffKey(model: unknown = '') {
  return String(model || '').trim().toLowerCase() || 'unknown';
}

function recordOpenRouterFailure(model: unknown, error: OpenRouterErrorRecord, now = Date.now()) {
  if (!shouldBackoffOpenRouterError(error)) {
    return 0;
  }

  const key = getBackoffKey(model);
  const previous = failureBackoffByModel.get(key);
  const failureCount = (previous?.failureCount || 0) + 1;
  const config = getBackoffConfig();
  const delayMs = Math.min(
    config.maxMs,
    Math.max(getRetryAfterMs(error, now), config.initialMs * (2 ** Math.min(failureCount - 1, 4)))
  );
  failureBackoffByModel.set(key, { failureCount, openedAt: now, retryAt: now + delayMs });
  return delayMs;
}

function clearOpenRouterFailure(model: unknown, requestStartedAt = Number.POSITIVE_INFINITY) {
  const key = getBackoffKey(model);
  const state = failureBackoffByModel.get(key);
  if (!state || state.openedAt < requestStartedAt) {
    failureBackoffByModel.delete(key);
  }
}

function assertOpenRouterRequestAllowed(model: unknown, now = Date.now()) {
  const key = getBackoffKey(model);
  const state = failureBackoffByModel.get(key);
  if (!state || state.retryAt <= now) {
    return;
  }

  const error: AppError & { retryAfterMs?: number } = new Error(`OpenRouter requests for model ${model || 'unknown'} are temporarily paused`);
  error.code = 'OPENROUTER_PROVIDER_BACKOFF';
  error.retryAfterMs = state.retryAt - now;
  throw error;
}

function extractContentPart(value: unknown): string {
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
    const content = value as DynamicRecord;
    return extractContentPart(content.text || content.content || content.outputText || content.output_text);
  }

  return '';
}

function extractAssistantContent(response: ChatResponse = {}) {
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

function parseJsonContent(content: unknown): unknown {
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

async function sendChatCompletion(openRouter: OpenRouterClient, chatRequest: ChatRequest, options: CompletionOptions = {}) {
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

function buildJsonChatRequest(request: ChatRequest): ChatRequest {
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

async function sendJsonChatCompletion(openRouter: OpenRouterClient, chatRequest: ChatRequest, options: CompletionOptions = {}) {
  const request = buildJsonChatRequest(chatRequest);
  assertOpenRouterRequestAllowed(request.model || options.metrics?.model);
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
    const response = await sendChatCompletion(openRouter, request, options) as ChatResponse;
    const outputChars = getChatOutputCharCount(response);
    const usage = extractUsage(response);
    const finishReason = getFinishReason(response);
    if (finishReason === 'error' || finishReason === 'content_filter') {
      const responseError = response.error || response.choices?.[0]?.error || {};
      const error = new Error(String(responseError.message || 'OpenRouter returned an error completion')) as CompletionError;
      error.code = typeof responseError.code === 'string' || typeof responseError.code === 'number'
        ? responseError.code
        : (finishReason === 'content_filter' ? 'OPENROUTER_CONTENT_FILTER' : 'OPENROUTER_COMPLETION_ERROR');
      error.statusCode = Number(responseError.statusCode || responseError.status || responseError.code) || undefined;
      error.error = responseError;
      throw error;
    }

    logAiRequestMetric({
      ...baseMetric,
      status: 'completed',
      durationMs: Date.now() - startedAt,
      outputChars,
      estimatedOutputTokens: estimateTokenCountFromChars(outputChars),
      finishReason,
      generationId: response.id,
      resolvedModel: response.model,
      serviceTier: response.serviceTier || response.service_tier,
      ...(usage || {})
    });

    clearOpenRouterFailure(request.model || options.metrics?.model, startedAt);

    return response;
  } catch (error) {
    const requestError = error as AppError & OpenRouterErrorRecord;
    const backoffMs = recordOpenRouterFailure(request.model || options.metrics?.model, requestError);
    logAiRequestMetric({
      ...baseMetric,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      errorName: requestError.name || 'Error',
      errorCode: requestError.code ?? requestError.error?.code,
      httpStatus: getErrorStatus(requestError),
      errorType: requestError.error?.metadata?.error_type,
      providerErrorCode: requestError.error?.metadata?.provider_code,
      backoffMs,
      errorMessage: requestError.message
    }, 'warn');
    throw error;
  }
}

export = {
  assertOpenRouterRequestAllowed,
  clearOpenRouterFailure,
  createOpenRouterClient,
  extractAssistantContent,
  getOpenRouterConfig,
  getRetryAfterMs,
  isTransientOpenRouterError,
  parseJsonContent,
  recordOpenRouterFailure,
  sendJsonChatCompletion,
  setOpenRouterSdkLoader,
  _resetFailureBackoff: () => failureBackoffByModel.clear()
};
