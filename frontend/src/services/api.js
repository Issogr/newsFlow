import axios from 'axios';

// Configurazione axios con timeout e retry
const api = axios.create({
  baseURL: '/api',
  timeout: 15000, // 15 secondi di timeout
  headers: {
    'Content-Type': 'application/json'
  }
});

// Intercettore per gestire errori di rete
api.interceptors.response.use(
  response => response,
  async error => {
    // Gestione specifica di errori comuni
    if (error.code === 'ECONNABORTED') {
      error.message = 'La richiesta è scaduta. Verifica la tua connessione internet e riprova.';
    } else if (!error.response) {
      error.message = 'Impossibile connettersi al server. Verifica la tua connessione internet.';
    } else if (error.response.status === 429) {
      error.message = 'Troppe richieste. Attendi qualche momento prima di riprovare.';
    }
    
    return Promise.reject(error);
  }
);

/**
 * Recupera tutte le notizie
 * @returns {Promise<Array>} - Array di gruppi di notizie
 */
export const fetchNews = async () => {
  try {
    const response = await api.get('/news');
    return response.data;
  } catch (error) {
    console.error('Error fetching news:', error);
    throw error;
  }
};

/**
 * Cerca notizie in base alla query
 * @param {string} query - Termine di ricerca
 * @returns {Promise<Array>} - Array di gruppi di notizie filtrati
 */
export const searchNews = async (query) => {
  if (!query || typeof query !== 'string' || query.trim() === '') {
    throw new Error('È necessario specificare un termine di ricerca valido');
  }
  
  try {
    // Sanitizza la query rimuovendo caratteri potenzialmente problematici
    const sanitizedQuery = encodeURIComponent(query.trim());
    
    const response = await api.get(`/news/search?query=${sanitizedQuery}`);
    return response.data;
  } catch (error) {
    console.error('Error searching news:', error);
    throw error;
  }
};

/**
 * Recupera i topic più popolari
 * @returns {Promise<Array>} - Array di topic popolari
 */
export const fetchHotTopics = async () => {
  try {
    const response = await api.get('/hot-topics');
    return response.data;
  } catch (error) {
    console.error('Error fetching hot topics:', error);
    throw error;
  }
};

/**
 * Recupera le fonti disponibili
 * @returns {Promise<Array>} - Array di fonti
 */
export const fetchSources = async () => {
  try {
    const response = await api.get('/sources');
    return response.data;
  } catch (error) {
    console.error('Error fetching sources:', error);
    throw error;
  }
};

/**
 * Recupera la mappa di equivalenza dei topic
 * @returns {Promise<Object>} - Mappa di equivalenza dei topic
 */
export const fetchTopicMap = async () => {
  try {
    const response = await api.get('/topics/map');
    return response.data;
  } catch (error) {
    console.error('Error fetching topic map:', error);
    throw error;
  }
};

/**
 * Recupera i topic di un articolo specifico
 * @param {string} articleId - ID dell'articolo
 * @returns {Promise<Object>} - Oggetto con i topic dell'articolo
 */
export const fetchArticleTopics = async (articleId) => {
  if (!articleId || typeof articleId !== 'string') {
    throw new Error('ID articolo non valido');
  }
  
  try {
    const response = await api.get(`/articles/${encodeURIComponent(articleId)}/topics`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching topics for article ${articleId}:`, error);
    throw error;
  }
};

// Esporta tutte le funzioni API
export default {
  fetchNews,
  searchNews,
  fetchHotTopics,
  fetchSources,
  fetchTopicMap,
  fetchArticleTopics
};