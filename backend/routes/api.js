const express = require('express');
const router = express.Router();
const { body, query, validationResult } = require('express-validator');
const newsService = require('../services/newsAggregator');
const topicNormalizer = require('../services/topicNormalizer');
const cache = require('memory-cache');
const logger = require('../utils/logger');
const { createError, asyncHandler } = require('../utils/errorHandler');

// Cache middleware ottimizzato
const cacheMiddleware = (duration) => {
  return (req, res, next) => {
    const key = '__express__' + req.originalUrl || req.url;
    const cachedBody = cache.get(key);
    
    if (cachedBody) {
      logger.debug(`Cache hit for ${key}`);
      res.send(cachedBody);
      return;
    } else {
      logger.debug(`Cache miss for ${key}`);
      res.sendResponse = res.send;
      res.send = (body) => {
        // Non mettere in cache risposte di errore
        if (res.statusCode < 400) {
          cache.put(key, body, duration * 1000);
        }
        res.sendResponse(body);
      };
      next();
    }
  };
};

// Get all news
router.get('/news', cacheMiddleware(300), asyncHandler(async (req, res) => {
  const news = await newsService.fetchAllNews();
  res.json(news);
}));

// Search news with validation
router.get('/news/search', [
  query('query').isString().trim().escape().isLength({ min: 1 })
    .withMessage('È necessario specificare un termine di ricerca valido')
], asyncHandler(async (req, res) => {
  // Verifica validazione
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createError(400, 'È necessario specificare un termine di ricerca valido', 'INVALID_QUERY');
  }
  
  const { query } = req.query;
  const results = await newsService.searchNews(query);
  res.json(results);
}));

// Get hot topics
router.get('/hot-topics', cacheMiddleware(1800), asyncHandler(async (req, res) => {
  const hotTopics = await newsService.getHotTopics();
  res.json(hotTopics);
}));

// Get topics with their variants
router.get('/topics/map', cacheMiddleware(86400), asyncHandler(async (req, res) => {
  // Restituisci la mappa di equivalenza dei topic
  res.json({
    topics: Object.keys(topicNormalizer.topicEquivalents),
    mappings: topicNormalizer.topicEquivalents
  });
}));

// Get news sources
router.get('/sources', cacheMiddleware(86400), asyncHandler(async (req, res) => {
  const sources = newsService.getSources();
  res.json(sources);
}));

// Health check endpoint
router.get('/health', (req, res) => {
  // Verifica l'accesso alla cache
  const cacheTest = cache.get('health_test');
  if (cacheTest === undefined) {
    cache.put('health_test', 'ok', 10 * 1000);
  }
  
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    cacheStatus: cacheTest !== undefined ? 'ok' : 'error'
  });
});

module.exports = router;