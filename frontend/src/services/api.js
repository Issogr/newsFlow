import axios from 'axios';

let authToken = window.localStorage.getItem('news-aggregator-token') || '';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json'
  }
});

api.interceptors.request.use((config) => {
  const nextConfig = { ...config };
  nextConfig.headers = nextConfig.headers || {};

  if (authToken) {
    nextConfig.headers.Authorization = `Bearer ${authToken}`;
  }

  return nextConfig;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === 'ECONNABORTED') {
      error.message = 'La richiesta è scaduta. Riprova tra qualche secondo.';
    } else if (!error.response) {
      error.message = 'Impossibile connettersi al server. Controlla la connessione.';
    } else if (error.response.status === 429) {
      error.message = 'Troppe richieste. Attendi qualche momento prima di riprovare.';
    }

    return Promise.reject(error);
  }
);

export const setAuthToken = (token) => {
  authToken = token || '';
  if (authToken) {
    window.localStorage.setItem('news-aggregator-token', authToken);
  } else {
    window.localStorage.removeItem('news-aggregator-token');
  }
};

export const getAuthToken = () => authToken;

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

export const updateUserSettings = async (payload) => {
  const response = await api.patch('/me/settings', payload);
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

export const fetchNews = async ({
  page = 1,
  pageSize = 12,
  search = '',
  sourceIds = [],
  topics = [],
  recentHours = null,
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

  const response = await api.get('/news', { params, signal });
  return response.data;
};

export const fetchReaderArticle = async (articleId, { refresh = false, signal } = {}) => {
  const response = await api.get(`/articles/${articleId}/reader`, {
    params: refresh ? { refresh: 'true' } : undefined,
    signal
  });

  return response.data;
};
