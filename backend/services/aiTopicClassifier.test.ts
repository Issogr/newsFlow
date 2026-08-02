const createMockLogger = require('../test-utils/mockLogger');
import type { Mock } from 'vitest';

jest.mock('../utils/logger', createMockLogger);

const logger = require('../utils/logger');
const aiTopicClassifier = require('./aiTopicClassifier');
const openRouterClient = require('./openRouterClient');
const { extractAssistantContent, parseJsonContent } = openRouterClient;

describe('aiTopicClassifier', () => {
  const originalEnv = process.env;
  let chatSend: Mock;
  let OpenRouterMock: Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    openRouterClient._resetFailureBackoff();
    chatSend = jest.fn();
    OpenRouterMock = jest.fn(() => ({
      chat: {
        send: chatSend
      }
    }));
    aiTopicClassifier._setOpenRouterSdkLoader(async () => ({ OpenRouter: OpenRouterMock }));
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_TOPIC_MODEL: 'topic-classifier-model',
      AI_TOPIC_BATCH_SIZE: undefined,
      AI_TOPIC_BATCH_CONCURRENCY: undefined,
      AI_TOPIC_MAX_ARTICLES_PER_REFRESH: undefined,
      AI_TOPIC_REQUEST_TIMEOUT_MS: undefined,
      AI_TOPIC_DETERMINISTIC_SKIP_ENABLED: 'false'
    };
  });

  afterEach(() => {
    aiTopicClassifier._setOpenRouterSdkLoader();
    openRouterClient._resetFailureBackoff();
    process.env = originalEnv;
  });

  function hasInfoLogMatching(fragment: string): boolean {
    return logger.info.mock.calls.some(([message]: [unknown]) => String(message || '').includes(fragment));
  }

  test('keeps the API key server-side while sending compact article payloads without RSS topics', async () => {
    chatSend.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ topicsByRef: [{ ref: 1, topics: [{ topic: 'Technology', confidence: 0.9, evidence: ['AI chips'] }, { topic: 'rss', confidence: 0.8, evidence: ['AI chips'] }] }] }) } }
      ]
    });

    const status = await aiTopicClassifier.classifyTopicDetailsForArticlesWithStatus([
      {
        id: 'article-1',
        source: 'Example Source',
        title: 'AI chips arrive for data centers',
        description: 'New hardware accelerates cloud workloads.',
        content: 'This full article body should not be sent to the model.',
        rawTopics: ['tech']
      }
    ]);

    const clientOptions = OpenRouterMock.mock.calls[0][0];
    const requestBody = chatSend.mock.calls[0][0].chatRequest;
    const requestOptions = chatSend.mock.calls[0][1];
    const prompt = requestBody.messages[1].content;
    const promptPayload = JSON.parse(prompt.split('\n').at(-1));

    expect(status.topicsByArticleId.get('article-1').map((entry: { topic: string }) => entry.topic)).toEqual(['Tecnologia']);
    expect(requestBody.model).toBe('topic-classifier-model');
    expect(requestBody.responseFormat).toEqual({ type: 'json_object' });
    expect(requestBody.reasoning).toEqual({
      enabled: false,
      effort: 'none',
      maxTokens: 0,
    });
    expect(requestBody.maxCompletionTokens).toBe(440);
    expect(requestOptions).toEqual({
      retries: { strategy: 'none' },
      timeoutMs: 30000
    });
    expect(clientOptions).toEqual(expect.objectContaining({
      apiKey: 'test-key',
      serverURL: 'https://openrouter.ai/api/v1',
      timeoutMs: 30000,
      httpReferer: expect.any(String),
      appTitle: 'News Flow'
    }));
    expect(prompt).toContain('AI chips arrive');
    expect(prompt).toContain('air/compressed-air weapons');
    expect(prompt).toContain('prefer Cronaca');
    expect(prompt).toContain('confidence');
    expect(prompt).toContain('Return refs, not article ids');
    expect(prompt).not.toContain('Evidence must be copied');
    expect(prompt).toContain('Return minified JSON only');
    expect(prompt).toContain('omit that ref');
    expect(prompt).toContain('Do not use provider RSS categories');
    expect(prompt).toContain('Use only the title and short description');
    expect(promptPayload.articles[0]).toEqual({
      ref: 1,
      title: 'AI chips arrive for data centers',
      description: 'New hardware accelerates cloud workloads.'
    });
    expect(prompt).not.toContain('article-1');
    expect(prompt).not.toContain('Example Source');
    expect(prompt).not.toContain('rawTopics');
    expect(prompt).not.toContain('This full article body should not be sent');
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('AI topic detection started'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('AI topic batch completed'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('AI topic detection completed'));
  });

  test('logs processed article titles only when AI article debug logging is enabled', async () => {
    process.env.AI_TOPIC_DEBUG_LOG_ARTICLES = 'true';
    chatSend.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ topicsById: [{ id: 'article-1', topics: [{ topic: 'Technology', confidence: 0.9, evidence: ['AI chips'] }] }] }) } }
      ]
    });

    await aiTopicClassifier.classifyTopicDetailsForArticlesWithStatus([
      { id: 'article-1', title: 'AI chips arrive for data centers', description: 'New hardware accelerates cloud workloads.' }
    ]);

    expect(hasInfoLogMatching('AI topic batch articles (dev):')).toBe(true);
    expect(hasInfoLogMatching('article-1:AI chips arrive for data centers')).toBe(true);
    expect(hasInfoLogMatching('AI topic batch classifications (dev):')).toBe(true);
    expect(hasInfoLogMatching('article-1:AI chips arrive for data centers->Tecnologia')).toBe(true);
  });

  test('does not log processed article titles when AI article debug logging is disabled', async () => {
    delete process.env.AI_TOPIC_DEBUG_LOG_ARTICLES;
    chatSend.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ topicsById: [{ id: 'article-1', topics: [{ topic: 'Technology', confidence: 0.9, evidence: ['AI chips'] }] }] }) } }
      ]
    });

    await aiTopicClassifier.classifyTopicDetailsForArticlesWithStatus([
      { id: 'article-1', title: 'AI chips arrive for data centers', description: 'New hardware accelerates cloud workloads.' }
    ]);

    expect(hasInfoLogMatching('AI topic batch articles (dev):')).toBe(false);
    expect(hasInfoLogMatching('AI topic batch classifications (dev):')).toBe(false);
  });

  test('does not accept legacy true-like values for AI article debug logging', async () => {
    process.env.AI_TOPIC_DEBUG_LOG_ARTICLES = '1';
    chatSend.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ topicsById: [{ id: 'article-1', topics: [{ topic: 'Technology', confidence: 0.9, evidence: ['AI chips'] }] }] }) } }
      ]
    });

    await aiTopicClassifier.classifyTopicDetailsForArticlesWithStatus([
      { id: 'article-1', title: 'AI chips arrive for data centers', description: 'New hardware accelerates cloud workloads.' }
    ]);

    expect(hasInfoLogMatching('AI topic batch articles (dev):')).toBe(false);
    expect(hasInfoLogMatching('AI topic batch classifications (dev):')).toBe(false);
  });

  test('returns no AI topics when disabled or unconfigured', async () => {
    delete process.env.OPENROUTER_API_KEY;

    const result = await aiTopicClassifier.classifyTopicDetailsForArticlesWithStatus([
      { id: 'article-1', title: 'Market rally' }
    ]);

    expect(result.topicsByArticleId.size).toBe(0);
    expect(chatSend).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('AI topic detection skipped: reason=missing_api_key'));
  });

  test('defaults to Mistral Small when the topic model env var is unset', () => {
    delete process.env.OPENROUTER_TOPIC_MODEL;

    expect(aiTopicClassifier._getConfig()).toEqual(expect.objectContaining({
      model: 'mistralai/mistral-small-24b-instruct-2501'
    }));
  });

  test('logs AI timeouts as fallback warnings without throwing', async () => {
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    const sdkPromise = Promise.reject(timeoutError);
    const catchSpy = jest.spyOn(sdkPromise, 'catch');
    chatSend.mockReturnValue(sdkPromise);

    const result = await aiTopicClassifier.classifyTopicDetailsForArticlesWithStatus([
      { id: 'article-1', title: 'Market rally' }
    ]);

    expect(result.topicsByArticleId.size).toBe(0);
    expect(catchSpy).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('AI topic batch failed: OpenRouter request timed out; keeping local fallback topics');
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('AI topic detection completed'));
  });

  test('reports attempted, failed, and capped article ids separately', async () => {
    process.env.AI_TOPIC_BATCH_SIZE = '1';
    process.env.AI_TOPIC_MAX_ARTICLES_PER_REFRESH = '2';
    chatSend
      .mockResolvedValueOnce({
        choices: [
          { message: { content: JSON.stringify({ topicsById: [{ id: 'article-1', topics: [{ topic: 'Technology', confidence: 0.9 }] }] }) } }
        ]
      })
      .mockRejectedValueOnce(new Error('temporary upstream failure'));

    const result = await aiTopicClassifier.classifyTopicDetailsForArticlesWithStatus([
      { id: 'article-1', title: 'AI chip rollout', description: 'Software and data center update' },
      { id: 'article-2', title: 'Market rally' },
      { id: 'article-3', title: 'Space mission' }
    ]);

    expect(result.topicsByArticleId.has('article-1')).toBe(true);
    expect(result.attemptedArticleIds).toEqual(['article-1', 'article-2']);
    expect(result.failedArticleIds).toEqual(['article-2']);
    expect(result.cappedArticleIds).toEqual(['article-3']);
  });

  test('stops later provider batches during backoff while preserving local classifications', async () => {
    process.env.AI_TOPIC_BATCH_SIZE = '1';
    process.env.AI_TOPIC_DETERMINISTIC_SKIP_ENABLED = 'true';
    process.env.OPENROUTER_FAILURE_BACKOFF_MS = '1000';
    process.env.OPENROUTER_FAILURE_MAX_BACKOFF_MS = '1000';
    chatSend.mockRejectedValue(Object.assign(new Error('rate limited'), {
      statusCode: 429,
      headers: { 'retry-after': '1' }
    }));

    const result = await aiTopicClassifier.classifyTopicDetailsForArticlesWithStatus([
      {
        id: 'local-article',
        title: 'AI software and cloud cybersecurity startup launches new chip platform',
        description: 'The digital hardware update includes semiconductor tools for data centers.'
      },
      { id: 'provider-article-1', title: 'Officials discuss a new proposal' },
      { id: 'provider-article-2', title: 'Markets react to the announcement' }
    ]);

    expect(chatSend).toHaveBeenCalledTimes(1);
    expect(result.topicsByArticleId.get('local-article')).toEqual([
      expect.objectContaining({ source: 'local' })
    ]);
    expect(result.failedArticleIds).toEqual(['provider-article-1', 'provider-article-2']);
  });

  test('drops unknown ids and topics outside the supported taxonomy', () => {
    const result = aiTopicClassifier._normalizeClassifierDetails({
      topicsById: [
        { id: 'article-1', topics: ['Economy', 'made up topic', 'Science'] },
        { id: 'article-2', topics: [] },
        { id: 'other-article', topics: ['Sport'] }
      ]
    }, new Set(['article-1', 'article-2']));

    expect(result.get('article-1').map((entry: { topic: string }) => entry.topic)).toEqual(['Economia', 'Scienza']);
    expect(result.has('article-2')).toBe(false);
    expect(result.has('other-article')).toBe(false);
  });

  test('does not normalize air-gun wording to technology', () => {
    const result = aiTopicClassifier._normalizeClassifierDetails({
      topicsById: [
        { id: 'article-1', topics: ['aria compressa', 'Cronaca'] }
      ]
    }, new Set(['article-1']));

    expect(result.get('article-1').map((entry: { topic: string }) => entry.topic)).toEqual(['Cronaca']);
  });

  test('accepts common model response, SDK content, and invalid JSON variants safely', () => {
    const result = aiTopicClassifier._normalizeClassifierDetails({
      results: [
        { articleId: 'article-1', category: 'Technology' },
        { article_id: 'article-2', topics: ['World'] }
      ]
    }, new Set(['article-1', 'article-2']));

    expect(result.get('article-1').map((entry: { topic: string }) => entry.topic)).toEqual(['Tecnologia']);
    expect(result.get('article-2').map((entry: { topic: string }) => entry.topic)).toEqual(['Esteri']);
    expect(extractAssistantContent({
      choices: [
        { message: { content: [{ type: 'text', text: '{"topicsById":[]}' }] } }
      ]
    })).toBe('{"topicsById":[]}');

    expect(extractAssistantContent({
      output_text: '{"topicsById":[]}'
    })).toBe('{"topicsById":[]}');

    expect(parseJsonContent('{"topicsById":[')).toBeNull();
    expect(parseJsonContent('```json\n{"topicsById":[{"id":"article-1"}]')).toBeNull();
  });

  test('uses a larger completion budget for structured JSON output', () => {
    expect(aiTopicClassifier._getCompletionTokenBudget(1)).toBe(440);
    expect(aiTopicClassifier._getCompletionTokenBudget(4)).toBe(800);
  });

  test('skips provider calls for high-confidence deterministic local topics', async () => {
    process.env.AI_TOPIC_DETERMINISTIC_SKIP_ENABLED = 'true';

    const result = await aiTopicClassifier.classifyTopicDetailsForArticlesWithStatus([
      {
        id: 'article-1',
        title: 'AI software and cloud cybersecurity startup launches new chip platform',
        description: 'The digital hardware update includes new semiconductor tools for data centers.'
      }
    ]);

    expect(chatSend).not.toHaveBeenCalled();
    expect(result.topicsByArticleId.get('article-1')).toEqual([
      expect.objectContaining({
        topic: 'Tecnologia',
        source: 'local',
        reasonCode: 'local_high_confidence_skip'
      })
    ]);
    expect(result.attemptedArticleIds).toEqual(['article-1']);
  });

  test('logs a safe reason when a completed AI response has no usable topics', async () => {
    chatSend.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ topicsById: [{ id: 'article-1', topics: [] }] }) } }
      ]
    });

    const result = await aiTopicClassifier.classifyTopicDetailsForArticlesWithStatus([
      { id: 'article-1', title: 'Market rally' }
    ]);

    expect(result.topicsByArticleId.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('AI topic batch produced no valid topics: reason=empty_topics'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('finishReason=unknown'));
  });

  test('rejects AI topics without matching evidence in the article text', () => {
    const articlesById = new Map([
      ['article-1', { id: 'article-1', title: 'Mercati in rialzo', description: 'Borsa positiva' }]
    ]);
    const result = aiTopicClassifier._normalizeClassifierDetails({
      topicsById: [
        { id: 'article-1', topics: [{ topic: 'Tecnologia', confidence: 0.92, evidence: ['software'] }] }
      ]
    }, new Set(['article-1']), articlesById);

    expect(result.has('article-1')).toBe(false);
  });

  test('accepts AI topics with confidence and evidence copied from the article text', () => {
    const articlesById = new Map([
      ['article-1', { id: 'article-1', title: 'Arrestato dopo una aggressione', description: 'Indaga la polizia' }]
    ]);
    const result = aiTopicClassifier._normalizeClassifierDetails({
      topicsById: [
        { id: 'article-1', topics: [{ topic: 'Cronaca', confidence: 0.88, evidence: ['aggressione', 'polizia'] }] }
      ]
    }, new Set(['article-1']), articlesById);

    expect(result.get('article-1')).toEqual([
      expect.objectContaining({ topic: 'Cronaca', confidence: 0.88, source: 'ai', reasonCode: 'ai_confident_evidence' })
    ]);
  });

  test('accepts AI topics with confidence even when evidence is omitted', () => {
    const result = aiTopicClassifier._normalizeClassifierDetails({
      topicsById: [
        { id: 'article-1', topics: [{ topic: 'Tecnologia', confidence: 0.86 }] }
      ]
    }, new Set(['article-1']), new Map([
      ['article-1', { id: 'article-1', title: 'Nuovi chip per AI', description: 'Data center e software' }]
    ]));

    expect(result.get('article-1')).toEqual([
      expect.objectContaining({ topic: 'Tecnologia', confidence: 0.86, source: 'ai' })
    ]);
  });
});
