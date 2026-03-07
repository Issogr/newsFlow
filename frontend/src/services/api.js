import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json'
  }
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

export const fetchNews = async ({
  page = 1,
  pageSize = 12,
  search = '',
  sourceIds = [],
  topics = [],
  recentHours = null
} = {}) => {
  const params = {
    page,
    pageSize
  };

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

  const response = await api.get('/news', { params });
  return response.data;
};

const apiService = {
  fetchNews
};

export default apiService;
