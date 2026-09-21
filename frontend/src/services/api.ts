import type {
  AdminSummary,
  AdminUser,
  ApiErrorLike,
  ApiTokenInfo,
  CurrentUser,
  DiscoveredFeed,
  FeedResponse,
  NewsSource,
  ReaderResponse,
  ThematicSummary,
  UserSettings,
} from '../types';

const READER_REQUEST_TIMEOUT_MS = 30000;
const FEEDBACK_REQUEST_TIMEOUT_MS = 60000;
const CUSTOM_SOURCE_REQUEST_TIMEOUT_MS = 45000;
export const AUTH_EXPIRED_EVENT = 'newsflow:auth-expired';

export const isRequestCanceled = (error: unknown) => {
  const candidate = error && typeof error === 'object' ? error as ApiErrorLike : {};
  return candidate.name === 'AbortError';
};

async function request<T>(path: string, { method = 'GET', body, params = {}, signal, timeout = 15000 }: {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number>;
  signal?: AbortSignal;
  timeout?: number;
} = {}): Promise<T> {
  const deadline = AbortSignal.timeout(timeout);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
  const multipart = body instanceof FormData;
  try {
    requestSignal.throwIfAborted();
    const response = await fetch(`/api${path}${query ? `?${query}` : ''}`, {
      method,
      credentials: 'same-origin',
      signal: requestSignal,
      headers: body !== undefined && !multipart ? { 'Content-Type': 'application/json' } : undefined,
      body: multipart ? body : body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let data: unknown = text;
    try { data = JSON.parse(text); } catch { /* Match empty and non-JSON HTTP responses. */ }
    if (!response.ok) {
      if (response.status === 401 && !path.includes('/auth/')) {
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      }
      throw Object.assign(new Error(`Request failed with status code ${response.status}`), {
        response: { status: response.status, statusText: response.statusText, data }
      });
    }
    return data as T;
  } catch (cause) {
    if (requestSignal.aborted) {
      if (requestSignal.reason?.name === 'TimeoutError') {
        throw Object.assign(new Error(`timeout of ${timeout}ms exceeded`), { code: 'ECONNABORTED', newsFlowClientCode: 'timeout' });
      }
      throw Object.assign(new Error('Request canceled'), { name: 'AbortError', code: 'ERR_CANCELED' });
    }
    const error = (cause instanceof Error ? cause : new Error(String(cause))) as Error & ApiErrorLike;
    if (!error.response) {
      error.newsFlowClientCode = 'network';
    }
    throw error;
  }
}

type Credentials = { username: string; password: string };
type RequestOptions = { signal?: AbortSignal };
type SettingsResponse = { settings: UserSettings; customSources?: NewsSource[]; [key: string]: unknown };
type SourceResponse = { source: NewsSource };

export const registerUser = ({ username, password }: Credentials) => request<CurrentUser>('/auth/register', { method: 'POST', body: { username, password } });

export const loginUser = ({ username, password }: Credentials) => request<CurrentUser>('/auth/login', { method: 'POST', body: { username, password } });

export const validatePasswordSetupToken = (token: string) => request<{ valid?: boolean; username?: string; purpose?: string; expiresAt?: string; isAdmin?: boolean }>('/auth/password-setup/validate', {
  params: { token }
});

export const completePasswordSetup = ({ token, password }: { token: string; password: string }) => request<CurrentUser>('/auth/password-setup/complete', { method: 'POST', body: { token, password } });

export const logoutUser = () => request('/auth/logout', { method: 'POST' });

export const fetchCurrentUser = () => request<CurrentUser>('/me');

export const createApiToken = (payload: Record<string, unknown> = {}) => request<{ tokenInfo?: ApiTokenInfo; token?: string }>('/me/api-token', { method: 'POST', body: payload });

export const revokeApiToken = () => request('/me/api-token', { method: 'DELETE' });

export const updateUserSettings = (payload: Partial<UserSettings>) => request<SettingsResponse>('/me/settings', { method: 'PATCH', body: payload });

export const submitFeedback = async ({ category, title, description, attachment = null }: { category: string; title: string; description: string; attachment?: File | null }) => {
  const formData = new FormData();
  formData.append('category', category);
  formData.append('title', title);
  formData.append('description', description);

  if (attachment) {
    formData.append('attachment', attachment);
  }

  return request('/me/feedback', {
    method: 'POST', body: formData,
    timeout: FEEDBACK_REQUEST_TIMEOUT_MS
  });
};

export const exportUserSettings = () => request<Record<string, unknown>>('/me/settings/export');

export const importUserSettings = (payload: unknown, { signal }: RequestOptions = {}) => request<Required<Pick<SettingsResponse, 'settings'>> & { customSources: NewsSource[] }>('/me/settings/import', {
  method: 'POST', body: payload,
  signal,
  timeout: CUSTOM_SOURCE_REQUEST_TIMEOUT_MS
});

export const discoverRssFeeds = (url: string, { signal }: RequestOptions = {}) => request<{ feeds: DiscoveredFeed[] }>('/me/sources/discover', {
  method: 'POST', body: { url },
  signal,
  timeout: CUSTOM_SOURCE_REQUEST_TIMEOUT_MS
});

export const addUserSource = (payload: { url: string }, { signal }: RequestOptions = {}) => request<SourceResponse>('/me/sources', {
  method: 'POST', body: payload,
  signal,
  timeout: CUSTOM_SOURCE_REQUEST_TIMEOUT_MS
});

export const updateUserSource = (sourceId: string, payload: Partial<NewsSource>, { signal }: RequestOptions = {}) => request<SourceResponse>(`/me/sources/${sourceId}`, {
  method: 'PATCH', body: payload,
  signal,
  timeout: CUSTOM_SOURCE_REQUEST_TIMEOUT_MS
});

export const deleteUserSource = (sourceId: string) => request(`/me/sources/${sourceId}`, { method: 'DELETE' });

export const fetchAdminUsers = ({ signal }: RequestOptions = {}) => request<{ users: AdminUser[]; summary: AdminSummary }>('/admin/users', { signal });

export const createAdminPasswordSetupLink = (userId: string) => request<{ setupLink: string; expiresAt: string }>(`/admin/users/${userId}/password-setup-link`, { method: 'POST' });

export const deleteAdminUser = (userId: string) => request(`/admin/users/${userId}`, { method: 'DELETE' });

export interface FeedRequestOptions extends RequestOptions {
  page?: number;
  pageSize?: number;
  search?: string;
  sourceIds?: string[];
  topics?: string[];
  beforePubDate?: string;
  beforeId?: string;
  excludeArticleIds?: string[];
  refresh?: boolean;
  includeFilters?: boolean;
}

function buildFeedParams({
  page = 1,
  pageSize = 12,
  search = '',
  sourceIds = [],
  topics = [],
  includeFilters = true
}: FeedRequestOptions = {}) {
  const params: Record<string, string | number> = { page, pageSize };

  if (search?.trim()) {
    params.search = search.trim();
  }

  if (Array.isArray(sourceIds) && sourceIds.length > 0) {
    params.sources = sourceIds.join(',');
  }

  if (Array.isArray(topics) && topics.length > 0) {
    params.topics = topics.join(',');
  }

  if (includeFilters) {
    params.includeFilters = 'true';
  }

  return params;
}

export const fetchNews = async ({
  beforePubDate = '',
  beforeId = '',
  excludeArticleIds = [],
  refresh = false,
  signal,
  ...filters
}: FeedRequestOptions) => {
  const params = buildFeedParams(filters);

  if (beforePubDate) {
    params.beforePubDate = beforePubDate;
  }

  if (beforeId) {
    params.beforeId = beforeId;
  }

  if (Array.isArray(excludeArticleIds) && excludeArticleIds.length > 0) {
    params.excludeArticleIds = excludeArticleIds.join(',');
  }

  if (refresh) {
    params.refresh = 'true';
  }

  return request<FeedResponse>('/news', { params, signal });
};

export const fetchReadLaterNews = ({ signal, ...filters }: FeedRequestOptions) => request<FeedResponse>('/read-later', {
  params: buildFeedParams(filters), signal
});

export const fetchThematicSummaries = ({ signal }: RequestOptions = {}) => request<{ items: ThematicSummary[]; readSummaryIds?: string[] }>('/thematic-summaries', { signal });

export const markThematicSummariesRead = (summaryIds: string[] = []) => request<{ readSummaryIds?: string[] }>('/me/thematic-summaries/read', { method: 'POST', body: { summaryIds } });

export const saveReadLaterArticles = (articleIds: string[] = []) => request('/me/read-later', { method: 'POST', body: { articleIds } });

export const removeReadLaterArticles = (articleIds: string[] = []) => request('/me/read-later/remove', { method: 'POST', body: { articleIds } });

export const fetchReaderArticle = (articleId: string, { refresh = false, signal }: RequestOptions & { refresh?: boolean } = {}) => request<ReaderResponse>(`/articles/${encodeURIComponent(articleId)}/reader`, {
  params: refresh ? { refresh: 'true' } : undefined,
  signal,
  timeout: READER_REQUEST_TIMEOUT_MS
});
