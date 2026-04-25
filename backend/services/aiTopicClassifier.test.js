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
      OPENROUTER_MODEL: 'liquid/lfm-2.5-1.2b-instruct:free'
    };
  });

  afterEach(() => {
    aiTopicClassifier._setOpenRouterSdkLoader();
    process.env = originalEnv;
  });

  test('keeps the API key server-side while sending compact article payloads without RSS topics', async () => {
    chatSend.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ topicsById: [{ id: 'article-1', topics: ['Technology', 'rss'] }] }) } }
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
    const prompt = requestBody.messages[1].content;

    expect(result.get('article-1')).toEqual(['Tecnologia']);
    expect(requestBody.model).toBe('liquid/lfm-2.5-1.2b-instruct:free');
    expect(clientOptions).toEqual(expect.objectContaining({
      apiKey: 'test-key',
      serverURL: 'https://openrouter.ai/api/v1',
      httpReferer: expect.any(String),
      appTitle: 'News Flow'
    }));
    expect(prompt).toContain('AI chips arrive');
    expect(prompt).toContain('Do not use provider RSS categories');
    expect(prompt).not.toContain('tech');
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

  test('drops unknown ids and topics outside the supported taxonomy', () => {
    const result = aiTopicClassifier._normalizeClassifierResult({
      topicsById: [
        { id: 'article-1', topics: ['Economy', 'made up topic', 'Science'] },
        { id: 'other-article', topics: ['Sport'] }
      ]
    }, new Set(['article-1']));

    expect(result.get('article-1')).toEqual(['Economia', 'Scienza']);
    expect(result.has('other-article')).toBe(false);
  });
});
