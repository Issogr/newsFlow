import axios from 'axios';

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
  (error) => {
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

export const isRequestCanceled = (error) => axios.isCancel?.(error) || error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError';

async function responseData(request) {
  const response = await request;
  return response.data;
}

export const registerUser = async ({ username, password }) => responseData(api.post('/auth/register', { username, password }));

export const loginUser = async ({ username, password }) => responseData(api.post('/auth/login', { username, password }));

export const validatePasswordSetupToken = async (token) => responseData(api.get('/auth/password-setup/validate', {
  params: { token }
}));

export const completePasswordSetup = async ({ token, password }) => responseData(api.post('/auth/password-setup/complete', { token, password }));

export const logoutUser = async () => responseData(api.post('/auth/logout'));

export const fetchCurrentUser = async () => responseData(api.get('/me'));

export const createApiToken = async (payload = {}) => responseData(api.post('/me/api-token', payload));

export const revokeApiToken = async () => responseData(api.delete('/me/api-token'));

export const updateUserSettings = async (payload) => responseData(api.patch('/me/settings', payload));

export const submitFeedback = async ({ category, title, description, attachment = null }) => {
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

export const exportUserSettings = async () => responseData(api.get('/me/settings/export'));

export const importUserSettings = async (payload, { signal } = {}) => responseData(api.post('/me/settings/import', payload, {
  signal,
  timeout: CUSTOM_SOURCE_REQUEST_TIMEOUT_MS
}));

export const addUserSource = async (payload, { signal } = {}) => responseData(api.post('/me/sources', payload, {
  signal,
  timeout: CUSTOM_SOURCE_REQUEST_TIMEOUT_MS
}));

export const updateUserSource = async (sourceId, payload, { signal } = {}) => responseData(api.patch(`/me/sources/${sourceId}`, payload, {
  signal,
  timeout: CUSTOM_SOURCE_REQUEST_TIMEOUT_MS
}));

export const deleteUserSource = async (sourceId) => responseData(api.delete(`/me/sources/${sourceId}`));

export const fetchAdminUsers = async ({ signal } = {}) => responseData(api.get('/admin/users', { signal }));

export const createAdminPasswordSetupLink = async (userId) => responseData(api.post(`/admin/users/${userId}/password-setup-link`));

export const deleteAdminUser = async (userId) => responseData(api.delete(`/admin/users/${userId}`));

function buildFeedParams({
  page = 1,
  pageSize = 12,
  search = '',
  sourceIds = [],
  topics = [],
  includeFilters = true
} = {}) {
  const params = { page, pageSize };

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
} = {}) => {
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

  return responseData(api.get('/news', { params, signal }));
};

export const fetchReadLaterNews = async ({
  page = 1,
  pageSize = 12,
  search = '',
  sourceIds = [],
  topics = [],
  includeFilters = true,
  signal
} = {}) => {
  return responseData(api.get('/read-later', {
    params: buildFeedParams({ page, pageSize, search, sourceIds, topics, includeFilters }),
    signal
  }));
};

export const fetchThematicSummaries = async ({ signal } = {}) => responseData(api.get('/thematic-summaries', { signal }));

export const markThematicSummariesRead = async (summaryIds = []) => responseData(api.post('/me/thematic-summaries/read', { summaryIds }));

export const saveReadLaterArticles = async (articleIds = []) => responseData(api.post('/me/read-later', { articleIds }));

export const removeReadLaterArticles = async (articleIds = []) => responseData(api.post('/me/read-later/remove', { articleIds }));

export const fetchReaderArticle = async (articleId, { refresh = false, signal } = {}) => responseData(api.get(`/articles/${encodeURIComponent(articleId)}/reader`, {
  params: refresh ? { refresh: 'true' } : undefined,
  signal,
  timeout: READER_REQUEST_TIMEOUT_MS
}));
