import { parseIntegerEnv } from '../utils/env';
import aiFeatures from '../config/aiFeatures';
import aiMetrics from '../utils/aiMetrics';
const { isOpenRouterFeatureEnabled } = aiFeatures;
const {
  estimateTokenCountFromChars,
  extractUsage,
  logAiRequestMetric
} = aiMetrics;
import type { AppError, DynamicRecord } from '../utils/types';

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_FAILURE_BACKOFF_MS = 60 * 1000;
const DEFAULT_FAILURE_MAX_BACKOFF_MS = 15 * 60 * 1000;

const failureBackoffByModel = new Map<string, { failureCount: number; openedAt: number; retryAt: number }>();

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

interface OpenRouterErrorRecord {
  code?: unknown;
  error?: {
    code?: unknown;
    metadata?: {
      error_type?: unknown;
      provider_code?: unknown;
    };
  };
  headers?: Headers;
  message?: string;
  name?: string;
  statusCode?: unknown;
}

interface ChatMessage extends DynamicRecord {
  content?: unknown;
}

interface ChatChoice extends DynamicRecord {
  error?: DynamicRecord;
  finish_reason?: unknown;
  message?: ChatMessage;
}

interface ChatResponse extends DynamicRecord {
  choices?: ChatChoice[];
  error?: DynamicRecord;
  id?: unknown;
  model?: unknown;
  service_tier?: unknown;
  usage?: DynamicRecord;
}

interface ChatRequest extends DynamicRecord {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  max_completion_tokens?: number;
  reasoning?: DynamicRecord;
  response_format?: DynamicRecord;
  stream?: false;
}

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

function getErrorStatus(error: OpenRouterErrorRecord = {}) {
  const status = Number(error.statusCode);
  return Number.isInteger(status) ? status : null;
}

function getRetryAfterMs(error: OpenRouterErrorRecord = {}, now = Date.now()) {
  const value = (error.headers?.get('retry-after') || '').trim();
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

function extractAssistantContent(response: ChatResponse = {}) {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  return Array.isArray(content)
    ? content.map((part) => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n')
    : '';
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

async function sendChatCompletion(config: OpenRouterConfig, chatRequest: ChatRequest, options: CompletionOptions) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': String(process.env.APP_BASE_URL || 'http://localhost'),
      'X-Title': 'News Flow'
    },
    body: JSON.stringify(chatRequest),
    signal: AbortSignal.timeout(options.timeoutMs ?? config.timeoutMs)
  });
  const payload = await response.json().catch((error: unknown) => {
    if (error instanceof SyntaxError) return null;
    throw error;
  }) as ChatResponse | null;
  if (!response.ok) {
    throw Object.assign(new Error(String(payload?.error?.message || `OpenRouter request failed (${response.status})`)), {
      statusCode: response.status,
      headers: response.headers,
      error: payload?.error
    });
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('OpenRouter returned invalid JSON');
  }
  return payload;
}

function buildJsonChatRequest(request: ChatRequest): ChatRequest {
  const maxTokens = request.max_tokens ?? request.max_completion_tokens;

  return {
    ...request,
    max_tokens: maxTokens,
    max_completion_tokens: request.max_completion_tokens ?? maxTokens,
    reasoning: request.reasoning || { enabled: false },
    response_format: request.response_format || { type: 'json_object' },
    stream: request.stream ?? false
  };
}

async function sendJsonChatCompletion(config: OpenRouterConfig, chatRequest: ChatRequest, options: CompletionOptions = {}) {
  const request = buildJsonChatRequest(chatRequest);
  assertOpenRouterRequestAllowed(request.model || options.metrics?.model);
  const startedAt = Date.now();
  const promptChars = request.messages.reduce((total, message) => total + message.content.length, 0);
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
    const response = await sendChatCompletion(config, request, options);
    const outputChars = extractAssistantContent(response).length;
    const usage = extractUsage(response);
    const finishReason = String(response.choices?.[0]?.finish_reason || '').trim() || null;
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
      serviceTier: response.service_tier,
      ...(usage || {})
    });

    clearOpenRouterFailure(request.model || options.metrics?.model, startedAt);

    return response;
  } catch (error) {
    const requestError = error as OpenRouterErrorRecord;
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

export default {
  assertOpenRouterRequestAllowed,
  clearOpenRouterFailure,
  extractAssistantContent,
  getOpenRouterConfig,
  getRetryAfterMs,
  isTransientOpenRouterError,
  parseJsonContent,
  recordOpenRouterFailure,
  sendJsonChatCompletion,
  _resetFailureBackoff: () => failureBackoffByModel.clear()
};
