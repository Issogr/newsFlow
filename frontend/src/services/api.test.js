var mockApi;
var mockApiConfig;

import axios from 'axios';
import { fetchReaderArticle } from './api';

vi.mock('axios', () => {
  const axios = {
    create: vi.fn((config) => {
      mockApiConfig = config;
      mockApi = {
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() }
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
});
