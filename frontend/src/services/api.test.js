var mockApi;

jest.mock('axios', () => ({
  create: jest.fn(() => {
    mockApi = {
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() }
      },
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn()
    };

    return mockApi;
  }),
  isCancel: jest.fn()
}));

describe('api service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    window.localStorage.clear();
  });

  test('uses a longer timeout budget for reader article requests', async () => {
    const { fetchReaderArticle } = require('./api');

    mockApi.get.mockResolvedValue({
      data: { articleId: 'article-1' }
    });

    await fetchReaderArticle('article-1', {
      refresh: true,
      signal: 'reader-signal'
    });

    expect(mockApi.get).toHaveBeenCalledWith('/articles/article-1/reader', {
      params: { refresh: 'true' },
      signal: 'reader-signal',
      timeout: 30000
    });
  });

  test('migrates legacy auth tokens to the newsflow storage key', () => {
    window.localStorage.setItem('news-aggregator-token', 'legacy-token');

    const { getAuthToken } = require('./api');

    expect(getAuthToken()).toBe('legacy-token');
    expect(window.localStorage.getItem('newsflow-token')).toBe('legacy-token');
    expect(window.localStorage.getItem('news-aggregator-token')).toBeNull();
  });

  test('stores auth tokens only under the newsflow storage key', () => {
    const { setAuthToken } = require('./api');

    window.localStorage.setItem('news-aggregator-token', 'stale-token');
    setAuthToken('fresh-token');

    expect(window.localStorage.getItem('newsflow-token')).toBe('fresh-token');
    expect(window.localStorage.getItem('news-aggregator-token')).toBeNull();
  });
});
