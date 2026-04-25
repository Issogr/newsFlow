jest.mock('../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const logger = require('../utils/logger');
const aiTopicClassifier = require('./aiTopicClassifier');

describe('aiTopicClassifier', () => {
  const originalEnv = process.env;
  let chatSend;
  let OpenRouterMock;

  beforeEach(() => {
    jest.clearAllMocks();
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
      OPENROUTER_MODEL: 'qwen/qwen3.5-9b',
      AI_TOPIC_BATCH_SIZE: undefined,
      AI_TOPIC_BATCH_CONCURRENCY: undefined,
      AI_TOPIC_REQUEST_TIMEOUT_MS: undefined
    };
  });

  afterEach(() => {
    aiTopicClassifier._setOpenRouterSdkLoader();
    process.env = originalEnv;
  });

  test('keeps the API key server-side while sending compact article payloads without RSS topics', async () => {
    chatSend.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ topicsById: [{ id: 'article-1', topics: [{ topic: 'Technology', confidence: 0.9, evidence: ['AI chips'] }, { topic: 'rss', confidence: 0.8, evidence: ['AI chips'] }] }] }) } }
      ]
    });

    const result = await aiTopicClassifier.classifyTopicsForArticles([
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

    expect(result.get('article-1')).toEqual(['Tecnologia']);
    expect(requestBody.model).toBe('qwen/qwen3.5-9b');
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
    expect(prompt).not.toContain('Evidence must be copied');
    expect(prompt).toContain('Return minified JSON only');
    expect(prompt).toContain('Return one object for every provided id');
    expect(prompt).toContain('Do not use provider RSS categories');
    expect(prompt).toContain('Use only the title and short description');
    expect(prompt).not.toContain('Example Source');
    expect(prompt).not.toContain('rawTopics');
    expect(prompt).not.toContain('This full article body should not be sent');
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('AI topic detection started'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('AI topic batch completed'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('AI topic detection completed'));
  });

  test('returns no AI topics when disabled or unconfigured', async () => {
    delete process.env.OPENROUTER_API_KEY;

    const result = await aiTopicClassifier.classifyTopicsForArticles([
      { id: 'article-1', title: 'Market rally' }
    ]);

    expect(result.size).toBe(0);
    expect(chatSend).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('AI topic detection skipped: reason=missing_api_key'));
  });

  test('logs AI timeouts as fallback warnings without throwing', async () => {
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    const sdkPromise = Promise.reject(timeoutError);
    const catchSpy = jest.spyOn(sdkPromise, 'catch');
    chatSend.mockReturnValue(sdkPromise);

    const result = await aiTopicClassifier.classifyTopicsForArticles([
      { id: 'article-1', title: 'Market rally' }
    ]);

    expect(result.size).toBe(0);
    expect(catchSpy).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('AI topic batch failed: OpenRouter request timed out; keeping local fallback topics');
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('AI topic detection completed'));
  });

  test('drops unknown ids and topics outside the supported taxonomy', () => {
    const result = aiTopicClassifier._normalizeClassifierResult({
      topicsById: [
        { id: 'article-1', topics: ['Economy', 'made up topic', 'Science'] },
        { id: 'article-2', topics: [] },
        { id: 'other-article', topics: ['Sport'] }
      ]
    }, new Set(['article-1', 'article-2']));

    expect(result.get('article-1')).toEqual(['Economia', 'Scienza']);
    expect(result.has('article-2')).toBe(false);
    expect(result.has('other-article')).toBe(false);
  });

  test('does not normalize air-gun wording to technology', () => {
    const result = aiTopicClassifier._normalizeClassifierResult({
      topicsById: [
        { id: 'article-1', topics: ['aria compressa', 'Cronaca'] }
      ]
    }, new Set(['article-1']));

    expect(result.get('article-1')).toEqual(['Cronaca']);
  });

  test('accepts common model response variants', () => {
    const result = aiTopicClassifier._normalizeClassifierResult({
      results: [
        { articleId: 'article-1', category: 'Technology' },
        { article_id: 'article-2', topics: ['World'] }
      ]
    }, new Set(['article-1', 'article-2']));

    expect(result.get('article-1')).toEqual(['Tecnologia']);
    expect(result.get('article-2')).toEqual(['Esteri']);
  });

  test('extracts assistant content from SDK response variants', () => {
    expect(aiTopicClassifier._extractAssistantContent({
      choices: [
        { message: { content: [{ type: 'text', text: '{"topicsById":[]}' }] } }
      ]
    })).toBe('{"topicsById":[]}');

    expect(aiTopicClassifier._extractAssistantContent({
      output_text: '{"topicsById":[]}'
    })).toBe('{"topicsById":[]}');
  });

  test('returns null instead of throwing on truncated JSON output', () => {
    expect(aiTopicClassifier._parseJsonContent('{"topicsById":[')).toBeNull();
    expect(aiTopicClassifier._parseJsonContent('```json\n{"topicsById":[{"id":"article-1"}]')).toBeNull();
  });

  test('uses a larger completion budget for structured JSON output', () => {
    expect(aiTopicClassifier._getCompletionTokenBudget(1)).toBe(440);
    expect(aiTopicClassifier._getCompletionTokenBudget(4)).toBe(800);
  });

  test('logs a safe reason when a completed AI response has no usable topics', async () => {
    chatSend.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ topicsById: [{ id: 'article-1', topics: [] }] }) } }
      ]
    });

    const result = await aiTopicClassifier.classifyTopicsForArticles([
      { id: 'article-1', title: 'Market rally' }
    ]);

    expect(result.size).toBe(0);
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
