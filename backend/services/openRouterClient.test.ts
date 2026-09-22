import createMockLogger from '../test-utils/mockLogger';
import { vi as jest, type Mock } from 'vitest';
jest.doMock('../utils/logger', () => ({ default: createMockLogger() }));
const logger: ReturnType<typeof require> = (await import('../utils/logger')).default;
const openRouterClient: ReturnType<typeof require> = (await import('./openRouterClient')).default;

const config = { apiKey: 'test-key', baseUrl: 'https://openrouter.ai/api/v1', timeoutMs: 1000 };
const request = { model: 'test/model', messages: [{ role: 'user', content: 'test' }], max_tokens: 20 };
const completed = () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] });

describe('openRouterClient', () => {
  const originalEnv = process.env;
  let fetchMock: Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    openRouterClient._resetFailureBackoff();
    fetchMock = jest.spyOn(globalThis, 'fetch');
    process.env = { ...originalEnv, OPENROUTER_FAILURE_BACKOFF_MS: '1000', OPENROUTER_FAILURE_MAX_BACKOFF_MS: '1000' };
  });

  afterEach(() => {
    fetchMock.mockRestore();
    openRouterClient._resetFailureBackoff();
    process.env = originalEnv;
  });

  test('sends native JSON requests and logs resolved generation and usage metadata', async () => {
    fetchMock.mockResolvedValue(Response.json({
      id: 'generation-1', model: 'resolved/model', service_tier: 'default',
      choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_tokens_details: { cached_tokens: 8 }, cost: 0.001 }
    }));
    await openRouterClient.sendJsonChatCompletion(config, request, { metrics: { feature: 'test' } });
    expect(fetchMock).toHaveBeenCalledWith(`${config.baseUrl}/chat/completions`, expect.objectContaining({
      method: 'POST', signal: expect.any(AbortSignal),
      headers: expect.objectContaining({ Authorization: 'Bearer test-key', 'Content-Type': 'application/json' })
    }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      ...request, stream: false, max_completion_tokens: 20, response_format: { type: 'json_object' },
      reasoning: { enabled: false }
    });
    expect(logger.info).toHaveBeenCalledWith('AI request metric', expect.objectContaining({
      model: 'test/model', resolvedModel: 'resolved/model', generationId: 'generation-1',
      serviceTier: 'default', cachedPromptTokens: 8, cost: 0.001, status: 'completed',
      promptChars: 4, outputChars: 11
    }));
  });

  test.each([{ enabled: true }, { effort: 'low' }, { max_tokens: 512 }])('preserves explicit reasoning options without conflicting defaults: %j', async (reasoning) => {
    fetchMock.mockResolvedValue(completed());
    await openRouterClient.sendJsonChatCompletion(config, { ...request, reasoning });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning).toEqual(reasoning);
  });

  test('logs safe HTTP errors and opens model-specific backoff using Retry-After', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: {
      code: 429, message: 'Failed https://user:pass@example.com/path?token=secret',
      metadata: { error_type: 'rate_limit', provider_code: 'provider_busy' }
    } }, { status: 429, headers: { 'retry-after': '1' } }));
    await expect(openRouterClient.sendJsonChatCompletion(config, request)).rejects.toMatchObject({ statusCode: 429 });
    await expect(openRouterClient.sendJsonChatCompletion(config, request)).rejects.toMatchObject({ code: 'OPENROUTER_PROVIDER_BACKOFF' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('AI request metric', expect.objectContaining({
      errorCode: 429, httpStatus: 429, errorType: 'rate_limit', providerErrorCode: 'provider_busy', backoffMs: 1000
    }));
    const metric = logger.warn.mock.calls[0][1];
    expect(metric.errorMessage).not.toContain('secret');
    expect(metric).not.toHaveProperty('body');
    expect(() => openRouterClient.assertOpenRouterRequestAllowed('other/model')).not.toThrow();
    expect(() => openRouterClient.assertOpenRouterRequestAllowed('test/model', Date.now() + 1100)).not.toThrow();
  });

  test('retains HTTP status when an upstream error body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('Service unavailable', { status: 503 }));
    await expect(openRouterClient.sendJsonChatCompletion(config, request)).rejects.toMatchObject({ statusCode: 503 });
    expect(() => openRouterClient.assertOpenRouterRequestAllowed('test/model')).toThrow('temporarily paused');
  });

  test('reads HTTP-date Retry-After values from native headers', () => {
    const now = Date.parse('2026-09-23T12:00:00.000Z');
    expect(openRouterClient.getRetryAfterMs({ headers: new Headers({ 'Retry-After': 'Wed, 23 Sep 2026 12:00:05 GMT' }) }, now)).toBe(5000);
    expect(openRouterClient.getRetryAfterMs({ headers: new Headers({ 'Retry-After': 'invalid' }) }, now)).toBe(0);
  });

  test('aborts requests at the configured deadline', async () => {
    fetchMock.mockImplementation((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
    }));
    await expect(openRouterClient.sendJsonChatCompletion(config, request, { timeoutMs: 5 }))
      .rejects.toMatchObject({ name: 'TimeoutError' });
    expect(logger.warn).toHaveBeenCalledWith('AI request metric', expect.objectContaining({ status: 'failed' }));
  });

  test('preserves timeouts while reading the response body', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    fetchMock.mockResolvedValue({ json: () => Promise.reject(timeout) });
    await expect(openRouterClient.sendJsonChatCompletion(config, request)).rejects.toBe(timeout);
    expect(() => openRouterClient.assertOpenRouterRequestAllowed('test/model')).toThrow('temporarily paused');
  });

  test('does not back off request-specific bad requests', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { message: 'Bad request' } }, { status: 400 })).mockResolvedValueOnce(completed());
    await expect(openRouterClient.sendJsonChatCompletion(config, request)).rejects.toMatchObject({ statusCode: 400 });
    await expect(openRouterClient.sendJsonChatCompletion(config, request)).resolves.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test.each(['error', 'content_filter'])('treats %s completions as failures without model backoff', async (finishReason) => {
    fetchMock.mockResolvedValueOnce(Response.json({ choices: [{ finish_reason: finishReason, message: { content: '' } }] })).mockResolvedValueOnce(completed());
    await expect(openRouterClient.sendJsonChatCompletion(config, request)).rejects.toMatchObject({
      code: finishReason === 'content_filter' ? 'OPENROUTER_CONTENT_FILTER' : 'OPENROUTER_COMPLETION_ERROR'
    });
    await expect(openRouterClient.sendJsonChatCompletion(config, request)).resolves.toBeTruthy();
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('AI request metric', expect.objectContaining({ status: 'failed' }));
  });

  test('backs off numeric transient error completions', async () => {
    fetchMock.mockResolvedValue(Response.json({ choices: [{
      finish_reason: 'error', message: { content: '' }, error: { message: 'Rate limited', code: 429 }
    }] }));
    await expect(openRouterClient.sendJsonChatCompletion(config, request)).rejects.toMatchObject({ code: 429 });
    await expect(openRouterClient.sendJsonChatCompletion(config, request)).rejects.toMatchObject({ code: 'OPENROUTER_PROVIDER_BACKOFF' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('does not let an older in-flight success clear a newer backoff', async () => {
    let resolveOlderRequest!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOlderRequest = resolve; }))
      .mockResolvedValueOnce(Response.json({ error: { message: 'Rate limited' } }, { status: 429 }));
    const olderCall = openRouterClient.sendJsonChatCompletion(config, request);
    await expect(openRouterClient.sendJsonChatCompletion(config, request)).rejects.toBeTruthy();
    resolveOlderRequest(completed());
    await olderCall;
    expect(() => openRouterClient.assertOpenRouterRequestAllowed('test/model')).toThrow('temporarily paused');
  });

  test.each([
    ['Forbidden by guardrail', false],
    ['API key lacks model permission', true]
  ])('applies the correct backoff for HTTP 403: %s', async (message, shouldBackoff) => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { message } }, { status: 403 })).mockResolvedValueOnce(completed());
    await expect(openRouterClient.sendJsonChatCompletion(config, request)).rejects.toMatchObject({ statusCode: 403 });
    const nextCall = openRouterClient.sendJsonChatCompletion(config, request);
    if (shouldBackoff) {
      await expect(nextCall).rejects.toMatchObject({ code: 'OPENROUTER_PROVIDER_BACKOFF' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } else {
      await expect(nextCall).resolves.toBeTruthy();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });
});
