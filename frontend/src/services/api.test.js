var mockApi;
var mockApiConfig;
var responseErrorHandler;

import axios from 'axios';
import { AUTH_EXPIRED_EVENT, fetchNews, fetchReaderArticle, submitFeedback } from './api';

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
    jest.clearAllMocks();
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

  test('targets the browser-facing BFF API namespace', () => {
    expect(mockApiConfig).toEqual(expect.objectContaining({
      baseURL: '/api',
      withCredentials: true
    }));
  });

  test('sends an explicit refresh flag for manual news refreshes', async () => {
    mockApi.get.mockResolvedValue({ data: { items: [] } });

    await fetchNews({ refresh: true });

    expect(mockApi.get).toHaveBeenCalledWith('/news', expect.objectContaining({
      params: expect.objectContaining({ refresh: 'true' })
    }));
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

    expect(mockApi.post).toHaveBeenCalledWith('/me/feedback', expect.any(FormData));
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
});
