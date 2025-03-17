const express = require('express');
const router = express.Router();
const newsService = require('../services/newsAggregator');
const topicNormalizer = require('../services/topicNormalizer');
const logger = require('../utils/logger');
const { asyncHandler, createError } = require('../utils/errorHandler');
const { sanitizeParam, sanitizeQuery, validateParam, validateQueryParam } = require('../utils/inputValidator');
const websocketService = require('../services/websocketService');

// Get all news
router.get('/news', asyncHandler(async (req, res) => {
  const news = await newsService.fetchAllNews();
  
  // Se non ci sono notizie, lancia un errore
  if (!news || news.length === 0) {
    throw createError(404, 'Nessuna notizia disponibile al momento', 'NO_NEWS_AVAILABLE');
  }
  
  res.json(news);
}));

// Search news con validazione e sanitizzazione
router.get('/news/search', [
  validateQueryParam('query', 'È necessario specificare un termine di ricerca'),
  sanitizeQuery('query')
], asyncHandler(async (req, res) => {
  const { query } = req.query;
  
  // Valida lunghezza minima
  if (query.length < 2) {
    throw createError(
      400, 
      'Il termine di ricerca deve contenere almeno 2 caratteri', 
      'INVALID_SEARCH_QUERY'
    );
  }
  
  const results = await newsService.searchNews(query);
  
  // Se non ci sono risultati, ritorna un array vuoto ma con status 200
  res.json(results.length === 0 ? [] : results);
}));

// Get hot topics
router.get('/hot-topics', asyncHandler(async (req, res) => {
  const hotTopics = await newsService.getHotTopics();
  
  // Se non ci sono hot topics, ritorna un array vuoto ma con status 200
  res.json(hotTopics.length === 0 ? [] : hotTopics);
}));

// Get topics with their variants
router.get('/topics/map', asyncHandler(async (req, res) => {
  // Ritorna una struttura vuota per retrocompatibilità poiché non usiamo più mappature statiche
  res.json({
    topics: [],
    mappings: {}
  });
}));

// Get news sources
router.get('/sources', asyncHandler(async (req, res) => {
  const sources = newsService.getSources();
  
  // Se non ci sono sources, ritorna un array vuoto con status 200
  res.json(sources.length === 0 ? [] : sources);
}));

// Nuova API per controllare lo stato di elaborazione dei topic
router.get('/articles/:articleId/topics', [
  validateParam('articleId', 'ID articolo non valido'),
  sanitizeParam('articleId')
], asyncHandler(async (req, res) => {
  const { articleId } = req.params;
  
  // Verifica se l'articleId è valido 
  if (!articleId || articleId.length < 5) {
    throw createError(400, 'ID articolo non valido', 'INVALID_ARTICLE_ID');
  }
  
  const asyncProcessor = require('../services/asyncProcessor');
  const topics = asyncProcessor.getTopicsForArticle(articleId);
  
  res.json({ articleId, topics });
}));

// Endpoint per forzare l'aggiornamento dei dati
router.post('/refresh', asyncHandler(async (req, res) => {
  const news = await newsService.forceRefresh();
  
  res.json({
    success: true,
    message: 'Dati aggiornati con successo',
    count: news.length
  });
}));

// Endpoint per ottenere lo stato di WebSocket
router.get('/ws/status', (req, res) => {
  const wsStats = websocketService.getStatistics();
  res.json(wsStats);
});

// Endpoint per inviare notifica a tutti i client
router.post('/ws/notify', [
  validateQueryParam('message', 'Messaggio richiesto'),
  sanitizeQuery('message')
], asyncHandler(async (req, res) => {
  const { message } = req.query;
  const type = req.query.type || 'info';
  
  // Valida il tipo di notifica
  if (!['info', 'warning', 'error'].includes(type)) {
    throw createError(400, 'Tipo di notifica non valido', 'INVALID_NOTIFICATION_TYPE');
  }
  
  // Invia la notifica
  websocketService.broadcastSystemNotification(message, type);
  
  res.json({
    success: true,
    message: 'Notifica inviata con successo',
    type
  });
}));

module.exports = router;