import { vi as jest } from 'vitest';
jest.doMock('./logger', () => {
  const info = jest.fn();
  const warn = jest.fn();

  return { default: {
    info,
    warn,
    log: jest.fn((level: string, ...args: unknown[]) => (level === 'warn' ? warn : info)(...args))
  } };
});

const logger: ReturnType<typeof require> = (await import('./logger')).default;
const { extractUsage, logAiRequestMetric } = (await import('./aiMetrics')).default;

describe('aiMetrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('extracts OpenRouter usage, cache, reasoning, and cost fields', () => {
    expect(extractUsage({
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 0 },
        completion_tokens_details: { reasoning_tokens: 0 },
        cost: 0.0012,
        is_byok: false,
        cost_details: {
          upstream_inference_cost: 0.001,
          upstream_inference_prompt_cost: 0.0008,
          upstream_inference_completions_cost: 0.0002
        }
      }
    })).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cachedPromptTokens: 80,
      cacheWritePromptTokens: 0,
      reasoningTokens: 0,
      cost: 0.0012,
      isByok: false,
      upstreamInferenceCost: 0.001,
      upstreamInferencePromptCost: 0.0008,
      upstreamInferenceCompletionsCost: 0.0002
    });
  });

  test('accepts raw snake-case usage without coercing null values to zero', () => {
    const usage = extractUsage({
      usage: {
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 12,
        prompt_tokens_details: { cached_tokens: null, cache_write_tokens: 4 },
        completion_tokens_details: { reasoning_tokens: 1 },
        cost: null,
        is_byok: true,
        cost_details: { upstream_inference_cost: null }
      }
    });

    expect(usage).toEqual(expect.objectContaining({
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
      cachedPromptTokens: null,
      cacheWritePromptTokens: 4,
      reasoningTokens: 1,
      cost: null,
      isByok: true,
      upstreamInferenceCost: null
    }));
  });

  test('redacts and bounds provider error messages in metric logs', () => {
    logAiRequestMetric({
      status: 'failed',
      errorMessage: `Authorization: Bearer sk-secret {"api_key":"sk-json"} request failed at https://user:pass@example.com/path?token=secret&next=value ${'x'.repeat(300)}`
    }, 'warn');

    const metric = logger.warn.mock.calls[0][1];
    expect(metric.errorMessage).toContain('https://[REDACTED]@example.com/path?token=[REDACTED]&next=[REDACTED]');
    expect(metric.errorMessage).not.toContain('secret');
    expect(metric.errorMessage).not.toContain('sk-json');
    expect(metric.errorMessage).toContain('Bearer [REDACTED]');
    expect(metric.errorMessage.length).toBeLessThanOrEqual(220);
  });
});
