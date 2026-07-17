jest.mock('./logger', () => ({
  info: jest.fn(),
  warn: jest.fn()
}));

const logger = require('./logger');
const { extractUsage, logAiRequestMetric } = require('./aiMetrics');

describe('aiMetrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('extracts OpenRouter usage, cache, reasoning, and cost fields', () => {
    expect(extractUsage({
      usage: {
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        promptTokensDetails: { cachedTokens: 80, cacheWriteTokens: 0 },
        completionTokensDetails: { reasoningTokens: 0 },
        cost: 0.0012,
        isByok: false,
        costDetails: {
          upstreamInferenceCost: 0.001,
          upstreamInferencePromptCost: 0.0008,
          upstreamInferenceCompletionsCost: 0.0002
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
