import axios from 'axios';

const READER_REQUEST_TIMEOUT_MS = 30000;
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
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json'
  }
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === 'ECONNABORTED') {
      error.message = 'The request timed out. Please try again in a few seconds.';
    } else if (!error.response) {
      error.message = 'Unable to connect to the server. Check your connection.';
    } else if (error.response.status === 401 && !isAuthRoute(error.config?.url)) {
      notifyAuthExpired();
    } else if (error.response.status === 429) {
      error.message = 'Too many requests. Please wait a moment before trying again.';
    }

    return Promise.reject(error);
  }
);

export const isRequestCanceled = (error) => {
  return axios.isCancel?.(error) || error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError';
};

export const registerUser = async ({ username, password }) => {
  const response = await api.post('/auth/register', { username, password });
  return response.data;
};

export const loginUser = async ({ username, password }) => {
  const response = await api.post('/auth/login', { username, password });
  return response.data;
};

export const validatePasswordSetupToken = async (token) => {
  const response = await api.get('/auth/password-setup/validate', {
    params: { token }
  });
  return response.data;
};

export const completePasswordSetup = async ({ token, password }) => {
  const response = await api.post('/auth/password-setup/complete', { token, password });
  return response.data;
};

export const logoutUser = async () => {
  const response = await api.post('/auth/logout');
  return response.data;
};

export const fetchCurrentUser = async () => {
  const response = await api.get('/me');
  return response.data;
};

export const createApiToken = async (payload = {}) => {
  const response = await api.post('/me/api-token', payload);
  return response.data;
};

export const revokeApiToken = async () => {
  const response = await api.delete('/me/api-token');
  return response.data;
};

export const updateUserSettings = async (payload) => {
  const response = await api.patch('/me/settings', payload);
  return response.data;
};

export const submitFeedback = async ({ category, title, description, attachment = null }) => {
  const formData = new FormData();
  formData.append('category', category);
  formData.append('title', title);
  formData.append('description', description);

  if (attachment) {
    formData.append('attachment', attachment);
  }

  const response = await api.post('/me/feedback', formData);
  return response.data;
};

export const exportUserSettings = async () => {
  const response = await api.get('/me/settings/export');
  return response.data;
};

export const importUserSettings = async (payload) => {
  const response = await api.post('/me/settings/import', payload);
  return response.data;
};

export const addUserSource = async (payload) => {
  const response = await api.post('/me/sources', payload);
  return response.data;
};

export const updateUserSource = async (sourceId, payload) => {
  const response = await api.patch(`/me/sources/${sourceId}`, payload);
  return response.data;
};

export const deleteUserSource = async (sourceId) => {
  const response = await api.delete(`/me/sources/${sourceId}`);
  return response.data;
};

export const fetchAdminUsers = async () => {
  const response = await api.get('/admin/users');
  return response.data;
};

export const createAdminPasswordSetupLink = async (userId) => {
  const response = await api.post(`/admin/users/${userId}/password-setup-link`);
  return response.data;
};

export const deleteAdminUser = async (userId) => {
  const response = await api.delete(`/admin/users/${userId}`);
  return response.data;
};

export const fetchNews = async ({
  page = 1,
  pageSize = 12,
  search = '',
  sourceIds = [],
  topics = [],
  recentHours = null,
  beforePubDate = '',
  beforeId = '',
  refresh = false,
  includeFilters = true,
  signal
} = {}) => {
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

  if (recentHours) {
    params.recentHours = recentHours;
  }

  if (beforePubDate) {
    params.beforePubDate = beforePubDate;
  }

  if (beforeId) {
    params.beforeId = beforeId;
  }

  if (refresh) {
    params.refresh = 'true';
  }

  if (includeFilters) {
    params.includeFilters = 'true';
  }

  const response = await api.get('/news', { params, signal });
  return response.data;
};

export const fetchReaderArticle = async (articleId, { refresh = false, signal } = {}) => {
  const response = await api.get(`/articles/${articleId}/reader`, {
    params: refresh ? { refresh: 'true' } : undefined,
    signal,
    timeout: READER_REQUEST_TIMEOUT_MS
  });

  return response.data;
};
