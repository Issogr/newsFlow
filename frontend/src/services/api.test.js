var mockApi;
var mockApiConfig;
var responseErrorHandler;

import axios from 'axios';
import { AUTH_EXPIRED_EVENT, fetchNews, fetchReadLaterNews, fetchReaderArticle, fetchThematicSummaries, isRequestCanceled, removeReadLaterArticles, saveReadLaterArticles, submitFeedback } from './api';

vi.mock('axios', () => {
  const axios = {
    create: vi.fn((config) => {
      mockApiConfig = config;
      mockApi = {
        interceptors: {
          request: { use: vi.fn() },
          response: {
            use: vi.fn((successHandler, errorHandler) => {
              responseErrorHandler = errorHandler;
            })
          }
        },
        get: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      };

      return mockApi;
    }),
    isCancel: vi.fn()
  };

  return {
    ...axios,
    default: axios
  };
});

describe('api service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    axios.isCancel.mockReturnValue(false);
    window.localStorage.clear();
  });

  test('uses a longer timeout budget for reader article requests', async () => {
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

  test('encodes reader article ids in route paths', async () => {
    mockApi.get.mockResolvedValue({
      data: { articleId: 'source/article 1' }
    });

    await fetchReaderArticle('source/article 1');

    expect(mockApi.get).toHaveBeenCalledWith('/articles/source%2Farticle%201/reader', expect.objectContaining({
      timeout: 30000
    }));
  });

  test('targets the browser-facing BFF API namespace', () => {
    expect(mockApiConfig).toEqual(expect.objectContaining({
      baseURL: '/api',
      withCredentials: true
    }));
  });

  test('builds news query params only from active filters and manual refresh state', async () => {
    mockApi.get.mockResolvedValue({ data: { items: [] } });

    await fetchNews({
      refresh: true,
      search: '  economy  ',
      sourceIds: ['ansa', 'bbc'],
      topics: ['Economy'],
      recentHours: 0,
      beforePubDate: '2026-05-21T10:00:00.000Z',
      beforeId: 'article-10',
      excludeArticleIds: ['article-2', 'article-3'],
      includeFilters: false,
      signal: 'news-signal'
    });

    expect(mockApi.get).toHaveBeenCalledWith('/news', {
      params: {
        page: 1,
        pageSize: 12,
        refresh: 'true',
        search: 'economy',
        sources: 'ansa,bbc',
        topics: 'Economy',
        beforePubDate: '2026-05-21T10:00:00.000Z',
        beforeId: 'article-10',
        excludeArticleIds: 'article-2,article-3'
      },
      signal: 'news-signal'
    });
  });

  test('lets the browser set multipart feedback boundaries', async () => {
    mockApi.post.mockResolvedValue({ data: { success: true } });
    const attachment = new File(['image'], 'screenshot.png', { type: 'image/png' });

    await submitFeedback({
      category: 'bug',
      title: 'Upload bug',
      description: 'The attachment should upload.',
      attachment
    });

    expect(mockApi.post).toHaveBeenCalledWith('/me/feedback', expect.any(FormData), {
      timeout: 60000
    });
    expect(mockApiConfig.headers?.['Content-Type']).toBeUndefined();
  });

  test('uses read-later endpoints for saved article lists and toggles', async () => {
    mockApi.get.mockResolvedValue({ data: { items: [] } });
    mockApi.post.mockResolvedValue({ data: { success: true } });

    await fetchReadLaterNews({ page: 2, sourceIds: ['source-a'], topics: ['Tecnologia'], recentHours: 2 });
    await saveReadLaterArticles(['article-1']);
    await removeReadLaterArticles(['article-1']);

    expect(mockApi.get).toHaveBeenCalledWith('/read-later', {
      params: {
        page: 2,
        pageSize: 12,
        sources: 'source-a',
        topics: 'Tecnologia',
        recentHours: 2,
        includeFilters: 'true'
      },
      signal: undefined
    });
    expect(mockApi.post).toHaveBeenCalledWith('/me/read-later', { articleIds: ['article-1'] });
    expect(mockApi.post).toHaveBeenCalledWith('/me/read-later/remove', { articleIds: ['article-1'] });
  });

  test('fetches thematic summaries from the app API', async () => {
    mockApi.get.mockResolvedValue({ data: { items: [] } });

    await fetchThematicSummaries({ signal: 'summary-signal' });

    expect(mockApi.get).toHaveBeenCalledWith('/thematic-summaries', { signal: 'summary-signal' });
  });

  test('broadcasts auth expiry when a non-auth request returns 401', async () => {
    const listener = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, listener);

    const error = {
      response: { status: 401 },
      config: { url: '/me' }
    };

    await expect(responseErrorHandler(error)).rejects.toBe(error);
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(AUTH_EXPIRED_EVENT, listener);
  });

  test('does not broadcast auth expiry for auth-route 401 responses', async () => {
    const listener = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, listener);

    const error = {
      response: { status: 401 },
      config: { url: '/auth/login' }
    };

    await expect(responseErrorHandler(error)).rejects.toBe(error);
    expect(listener).not.toHaveBeenCalled();

    window.removeEventListener(AUTH_EXPIRED_EVENT, listener);
  });

  test.each([
    ['timeout', { code: 'ECONNABORTED', config: { url: '/news' } }, 'timeout'],
    ['network', { config: { url: '/news' } }, 'network']
  ])('marks %s errors with a structured client code', async (label, error, clientCode) => {
    await expect(responseErrorHandler(error)).rejects.toBe(error);

    expect(error.newsFlowClientCode).toBe(clientCode);
  });

  test('leaves HTTP response errors response-driven', async () => {
    const error = { response: { status: 429 }, config: { url: '/news' } };

    await expect(responseErrorHandler(error)).rejects.toBe(error);

    expect(error.newsFlowClientCode).toBeUndefined();
  });

  test('recognizes axios and native cancellation errors', () => {
    axios.isCancel.mockImplementation((error) => error?.axiosCancel === true);

    expect(isRequestCanceled({ axiosCancel: true })).toBe(true);
    expect(isRequestCanceled({ code: 'ERR_CANCELED' })).toBe(true);
    expect(isRequestCanceled({ name: 'CanceledError' })).toBe(true);
    expect(isRequestCanceled(new Error('other'))).toBe(false);
  });
});
