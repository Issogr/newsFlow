import axios, { type AxiosError, type AxiosPromise } from 'axios';
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

function isAuthRoute(url = '') {
  return String(url || '').includes('/auth/');
}

function notifyAuthExpired() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
  withCredentials: true
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError & ApiErrorLike) => {
    if (error.code === 'ECONNABORTED') {
      error.newsFlowClientCode = 'timeout';
    } else if (!error.response) {
      error.newsFlowClientCode = 'network';
    } else if (error.response.status === 401 && !isAuthRoute(error.config?.url)) {
      notifyAuthExpired();
    }

    return Promise.reject(error);
  }
);

export const isRequestCanceled = (error: unknown) => {
  const candidate = error && typeof error === 'object' ? error as ApiErrorLike : {};
  return axios.isCancel?.(error) || candidate.code === 'ERR_CANCELED' || candidate.name === 'CanceledError';
};

async function responseData<T>(request: AxiosPromise<T>): Promise<T> {
  const response = await request;
  return response.data;
}

type Credentials = { username: string; password: string };
type RequestOptions = { signal?: AbortSignal };
type SettingsResponse = { settings: UserSettings; customSources?: NewsSource[]; [key: string]: unknown };
type SourceResponse = { source: NewsSource };

export const registerUser = async ({ username, password }: Credentials) => responseData<CurrentUser>(api.post('/auth/register', { username, password }));

export const loginUser = async ({ username, password }: Credentials) => responseData<CurrentUser>(api.post('/auth/login', { username, password }));

export const validatePasswordSetupToken = async (token: string) => responseData<{ valid?: boolean; username?: string; purpose?: string; expiresAt?: string; isAdmin?: boolean }>(api.get('/auth/password-setup/validate', {
  params: { token }
}));

export const completePasswordSetup = async ({ token, password }: { token: string; password: string }) => responseData<CurrentUser>(api.post('/auth/password-setup/complete', { token, password }));

export const logoutUser = async () => responseData(api.post('/auth/logout'));

export const fetchCurrentUser = async () => responseData<CurrentUser>(api.get('/me'));

export const createApiToken = async (payload: Record<string, unknown> = {}) => responseData<{ tokenInfo?: ApiTokenInfo; token?: string }>(api.post('/me/api-token', payload));

export const revokeApiToken = async () => responseData(api.delete('/me/api-token'));

export const updateUserSettings = async (payload: Partial<UserSettings>) => responseData<SettingsResponse>(api.patch('/me/settings', payload));

export const submitFeedback = async ({ category, title, description, attachment = null }: { category: string; title: string; description: string; attachment?: File | null }) => {
  const formData = new FormData();
  formData.append('category', category);
  formData.append('title', title);
  formData.append('description', description);

  if (attachment) {
    formData.append('attachment', attachment);
  }

  return responseData(api.post('/me/feedback', formData, {
    timeout: FEEDBACK_REQUEST_TIMEOUT_MS
  }));
};

export const exportUserSettings = async () => responseData<Record<string, unknown>>(api.get('/me/settings/export'));

export const importUserSettings = async (payload: unknown, { signal }: RequestOptions = {}) => responseData<Required<Pick<SettingsResponse, 'settings'>> & { customSources: NewsSource[] }>(api.post('/me/settings/import', payload, {
  signal,
  timeout: CUSTOM_SOURCE_REQUEST_TIMEOUT_MS
}));

export const discoverRssFeeds = async (url: string, { signal }: RequestOptions = {}) => responseData<{ feeds: DiscoveredFeed[] }>(api.post('/me/sources/discover', { url }, {
  signal,
  timeout: CUSTOM_SOURCE_REQUEST_TIMEOUT_MS
}));

export const addUserSource = async (payload: { url: string }, { signal }: RequestOptions = {}) => responseData<SourceResponse>(api.post('/me/sources', payload, {
  signal,
  timeout: CUSTOM_SOURCE_REQUEST_TIMEOUT_MS
}));

export const updateUserSource = async (sourceId: string, payload: Partial<NewsSource>, { signal }: RequestOptions = {}) => responseData<SourceResponse>(api.patch(`/me/sources/${sourceId}`, payload, {
  signal,
  timeout: CUSTOM_SOURCE_REQUEST_TIMEOUT_MS
}));

export const deleteUserSource = async (sourceId: string) => responseData(api.delete(`/me/sources/${sourceId}`));

export const fetchAdminUsers = async ({ signal }: RequestOptions = {}) => responseData<{ users: AdminUser[]; summary: AdminSummary }>(api.get('/admin/users', { signal }));

export const createAdminPasswordSetupLink = async (userId: string) => responseData<{ setupLink: string; expiresAt: string }>(api.post(`/admin/users/${userId}/password-setup-link`));

export const deleteAdminUser = async (userId: string) => responseData(api.delete(`/admin/users/${userId}`));

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
  page = 1,
  pageSize = 12,
  search = '',
  sourceIds = [],
  topics = [],
  beforePubDate = '',
  beforeId = '',
  excludeArticleIds = [],
  refresh = false,
  includeFilters = true,
  signal
}: FeedRequestOptions) => {
  const params = buildFeedParams({ page, pageSize, search, sourceIds, topics, includeFilters });

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

  return responseData<FeedResponse>(api.get('/news', { params, signal }));
};

export const fetchReadLaterNews = async ({
  page = 1,
  pageSize = 12,
  search = '',
  sourceIds = [],
  topics = [],
  includeFilters = true,
  signal
}: FeedRequestOptions) => {
  return responseData<FeedResponse>(api.get('/read-later', {
    params: buildFeedParams({ page, pageSize, search, sourceIds, topics, includeFilters }),
    signal
  }));
};

export const fetchThematicSummaries = async ({ signal }: RequestOptions = {}) => responseData<{ items: ThematicSummary[]; readSummaryIds?: string[] }>(api.get('/thematic-summaries', { signal }));

export const markThematicSummariesRead = async (summaryIds: string[] = []) => responseData<{ readSummaryIds?: string[] }>(api.post('/me/thematic-summaries/read', { summaryIds }));

export const saveReadLaterArticles = async (articleIds: string[] = []) => responseData(api.post('/me/read-later', { articleIds }));

export const removeReadLaterArticles = async (articleIds: string[] = []) => responseData(api.post('/me/read-later/remove', { articleIds }));

export const fetchReaderArticle = async (articleId: string, { refresh = false, signal }: RequestOptions & { refresh?: boolean } = {}) => responseData<ReaderResponse>(api.get(`/articles/${encodeURIComponent(articleId)}/reader`, {
  params: refresh ? { refresh: 'true' } : undefined,
  signal,
  timeout: READER_REQUEST_TIMEOUT_MS
}));
