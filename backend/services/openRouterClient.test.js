const createMockLogger = require('../test-utils/mockLogger');

jest.mock('../utils/logger', createMockLogger);

const logger = require('../utils/logger');
const openRouterClient = require('./openRouterClient');

describe('openRouterClient', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    openRouterClient._resetFailureBackoff();
    process.env = {
      ...originalEnv,
      OPENROUTER_FAILURE_BACKOFF_MS: '1000',
      OPENROUTER_FAILURE_MAX_BACKOFF_MS: '1000'
    };
  });

  afterEach(() => {
    openRouterClient._resetFailureBackoff();
    process.env = originalEnv;
  });

  test('logs resolved generation and detailed usage metadata', async () => {
    const openRouter = {
      chat: {
        send: jest.fn().mockResolvedValue({
          id: 'generation-1',
          model: 'resolved/model',
          serviceTier: 'default',
          choices: [{ finishReason: 'stop', message: { content: '{"ok":true}' } }],
          usage: {
            promptTokens: 10,
            completionTokens: 2,
            totalTokens: 12,
            promptTokensDetails: { cachedTokens: 8 },
            cost: 0.001
          }
        })
      }
    };

    await openRouterClient.sendJsonChatCompletion(openRouter, {
      model: 'requested/model',
      messages: [{ role: 'user', content: 'test' }],
      maxTokens: 20
    }, { metrics: { feature: 'test' } });

    expect(logger.info).toHaveBeenCalledWith('AI request metric', expect.objectContaining({
      model: 'requested/model',
      resolvedModel: 'resolved/model',
      generationId: 'generation-1',
      serviceTier: 'default',
      cachedPromptTokens: 8,
      cost: 0.001,
      status: 'completed'
    }));
  });

  test('logs safe structured HTTP errors and opens model-specific backoff', async () => {
    const error = Object.assign(new Error('Failed https://user:pass@example.com/path?token=secret'), {
      name: 'TooManyRequestsResponseError',
      statusCode: 429,
      headers: { 'retry-after': '1' },
      error: {
        code: 429,
        metadata: { error_type: 'rate_limit', provider_code: 'provider_busy' }
      },
      body: 'must not be logged'
    });
    const send = jest.fn().mockRejectedValue(error);
    const request = {
      model: 'limited/model',
      messages: [{ role: 'user', content: 'test' }],
      maxTokens: 20
    };

    await expect(openRouterClient.sendJsonChatCompletion({ chat: { send } }, request)).rejects.toBe(error);
    await expect(openRouterClient.sendJsonChatCompletion({ chat: { send } }, request))
      .rejects.toMatchObject({ code: 'OPENROUTER_PROVIDER_BACKOFF' });

    expect(send).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('AI request metric', expect.objectContaining({
      errorName: 'TooManyRequestsResponseError',
      errorCode: 429,
      httpStatus: 429,
      errorType: 'rate_limit',
      providerErrorCode: 'provider_busy',
      backoffMs: 1000
    }));
    const metric = logger.warn.mock.calls[0][1];
    expect(metric.errorMessage).not.toContain('secret');
    expect(metric).not.toHaveProperty('body');

    expect(() => openRouterClient.assertOpenRouterRequestAllowed('other/model')).not.toThrow();
    expect(() => openRouterClient.assertOpenRouterRequestAllowed('limited/model', Date.now() + 1100)).not.toThrow();
  });

  test('does not back off request-specific bad requests', async () => {
    const error = Object.assign(new Error('Bad request'), { statusCode: 400 });
    const send = jest.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ choices: [{ message: { content: '{}' } }] });
    const request = { model: 'test/model', messages: [{ role: 'user', content: 'test' }], maxTokens: 20 };

    await expect(openRouterClient.sendJsonChatCompletion({ chat: { send } }, request)).rejects.toBe(error);
    await expect(openRouterClient.sendJsonChatCompletion({ chat: { send } }, request)).resolves.toBeTruthy();
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('treats error completions as failures without opening backoff', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({
        choices: [{ finishReason: 'error', message: { content: '' } }],
        error: { message: 'Prompt was blocked', code: 'moderation_block' }
      })
      .mockResolvedValueOnce({ choices: [{ finishReason: 'stop', message: { content: '{}' } }] });
    const request = { model: 'test/model', messages: [{ role: 'user', content: 'test' }], maxTokens: 20 };

    await expect(openRouterClient.sendJsonChatCompletion({ chat: { send } }, request))
      .rejects.toMatchObject({ code: 'moderation_block' });
    await expect(openRouterClient.sendJsonChatCompletion({ chat: { send } }, request)).resolves.toBeTruthy();
    expect(send).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('AI request metric', expect.objectContaining({ status: 'failed' }));
  });

  test('treats content-filter completions as retryable feature failures', async () => {
    const send = jest.fn().mockResolvedValue({
      choices: [{ finishReason: 'content_filter', message: { content: '' } }]
    });
    const request = { model: 'test/model', messages: [{ role: 'user', content: 'test' }], maxTokens: 20 };

    await expect(openRouterClient.sendJsonChatCompletion({ chat: { send } }, request))
      .rejects.toMatchObject({ code: 'OPENROUTER_CONTENT_FILTER' });
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('AI request metric', expect.objectContaining({ status: 'failed' }));
  });

  test('backs off numeric transient error completions', async () => {
    const send = jest.fn().mockResolvedValue({
      choices: [{
        finishReason: 'error',
        message: { content: '' },
        error: { message: 'Rate limited', code: 429 }
      }]
    });
    const request = { model: 'test/model', messages: [{ role: 'user', content: 'test' }], maxTokens: 20 };

    await expect(openRouterClient.sendJsonChatCompletion({ chat: { send } }, request))
      .rejects.toMatchObject({ code: 429 });
    await expect(openRouterClient.sendJsonChatCompletion({ chat: { send } }, request))
      .rejects.toMatchObject({ code: 'OPENROUTER_PROVIDER_BACKOFF' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('does not let an older in-flight success clear a newer backoff', async () => {
    let resolveOlderRequest;
    const olderResponse = new Promise((resolve) => {
      resolveOlderRequest = resolve;
    });
    const olderSend = jest.fn(() => olderResponse);
    const limitedSend = jest.fn().mockRejectedValue(Object.assign(new Error('rate limited'), { statusCode: 429 }));
    const request = { model: 'shared/model', messages: [{ role: 'user', content: 'test' }], maxTokens: 20 };

    const olderCall = openRouterClient.sendJsonChatCompletion({ chat: { send: olderSend } }, request);
    await expect(openRouterClient.sendJsonChatCompletion({ chat: { send: limitedSend } }, request)).rejects.toBeTruthy();
    resolveOlderRequest({ choices: [{ finishReason: 'stop', message: { content: '{}' } }] });
    await olderCall;

    let backoffError;
    try {
      openRouterClient.assertOpenRouterRequestAllowed('shared/model');
    } catch (error) {
      backoffError = error;
    }
    expect(backoffError).toEqual(expect.objectContaining({ code: 'OPENROUTER_PROVIDER_BACKOFF' }));
  });

  test('does not model-backoff moderation-shaped HTTP 403 responses', async () => {
    const error = Object.assign(new Error('Forbidden by guardrail'), { statusCode: 403 });
    const send = jest.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ choices: [{ message: { content: '{}' } }] });
    const request = { model: 'test/model', messages: [{ role: 'user', content: 'test' }], maxTokens: 20 };

    await expect(openRouterClient.sendJsonChatCompletion({ chat: { send } }, request)).rejects.toBe(error);
    await expect(openRouterClient.sendJsonChatCompletion({ chat: { send } }, request)).resolves.toBeTruthy();
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('backs off permission-shaped HTTP 403 responses', async () => {
    const error = Object.assign(new Error('API key lacks model permission'), { statusCode: 403 });
    const send = jest.fn().mockRejectedValue(error);
    const request = { model: 'test/model', messages: [{ role: 'user', content: 'test' }], maxTokens: 20 };

    await expect(openRouterClient.sendJsonChatCompletion({ chat: { send } }, request)).rejects.toBe(error);
    await expect(openRouterClient.sendJsonChatCompletion({ chat: { send } }, request))
      .rejects.toMatchObject({ code: 'OPENROUTER_PROVIDER_BACKOFF' });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
