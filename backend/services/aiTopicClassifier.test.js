jest.mock('axios', () => ({
  post: jest.fn()
}));

jest.mock('../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const axios = require('axios');
const aiTopicClassifier = require('./aiTopicClassifier');

describe('aiTopicClassifier', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_MODEL: 'liquid/lfm-2.5-1.2b-instruct:free'
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('keeps the API key server-side while sending compact article payloads without RSS topics', async () => {
    axios.post.mockResolvedValue({
      data: {
        choices: [
          { message: { content: JSON.stringify({ topicsById: [{ id: 'article-1', topics: ['Technology', 'rss'] }] }) } }
        ]
      }
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

    const requestBody = axios.post.mock.calls[0][1];
    const requestConfig = axios.post.mock.calls[0][2];
    const prompt = requestBody.messages[1].content;

    expect(result.get('article-1')).toEqual(['Tecnologia']);
    expect(requestBody.model).toBe('liquid/lfm-2.5-1.2b-instruct:free');
    expect(requestConfig.headers.Authorization).toBe('Bearer test-key');
    expect(prompt).toContain('AI chips arrive');
    expect(prompt).toContain('Do not use provider RSS categories');
    expect(prompt).not.toContain('tech');
    expect(prompt).not.toContain('This full article body should not be sent');
  });

  test('returns no AI topics when disabled or unconfigured', async () => {
    delete process.env.OPENROUTER_API_KEY;

    const result = await aiTopicClassifier.classifyTopicsForArticles([
      { id: 'article-1', title: 'Market rally' }
    ]);

    expect(result.size).toBe(0);
    expect(axios.post).not.toHaveBeenCalled();
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
