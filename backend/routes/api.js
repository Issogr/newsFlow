const express = require('express');
const router = express.Router();
const newsService = require('../services/newsAggregator');
const cache = require('memory-cache');
const logger = require('../utils/logger');

// Cache middleware
const cacheMiddleware = (duration) => {
  return (req, res, next) => {
    const key = '__express__' + req.originalUrl || req.url;
    const cachedBody = cache.get(key);
    
    if (cachedBody) {
      res.send(cachedBody);
      return;
    } else {
      res.sendResponse = res.send;
      res.send = (body) => {
        cache.put(key, body, duration * 1000);
        res.sendResponse(body);
      };
      next();
    }
  };
};

// Get all news
router.get('/news', cacheMiddleware(300), async (req, res, next) => {
  try {
    const news = await newsService.fetchAllNews();
    res.json(news);
  } catch (error) {
    // Se l'errore è già formattato (ad es. dal newsService)
    if (error.status && error.message) {
      return res.status(error.status).json({ 
        error: {
          message: error.message,
          code: error.code || 'ERROR'
        }
      });
    }
    
    // Altrimenti, è un errore generico
    logger.error(`Error fetching news: ${error.message}`);
    res.status(500).json({ 
      error: { 
        message: 'Si è verificato un errore interno. Riprova più tardi.',
        code: 'SERVER_ERROR'
      } 
    });
  }
});

// Search news
router.get('/news/search', async (req, res, next) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ 
        error: { 
          message: 'È necessario specificare un termine di ricerca',
          code: 'MISSING_QUERY'
        } 
      });
    }
    
    const results = await newsService.searchNews(query);
    res.json(results);
  } catch (error) {
    // Se l'errore è già formattato (ad es. dal newsService)
    if (error.status && error.message) {
      return res.status(error.status).json({ 
        error: {
          message: error.message,
          code: error.code || 'ERROR'
        }
      });
    }
    
    // Altrimenti, è un errore generico
    logger.error(`Error searching news: ${error.message}`);
    res.status(500).json({ 
      error: { 
        message: 'Si è verificato un errore durante la ricerca. Riprova più tardi.',
        code: 'SEARCH_ERROR'
      } 
    });
  }
});

// Get hot topics
router.get('/hot-topics', cacheMiddleware(1800), async (req, res, next) => {
  try {
    const hotTopics = await newsService.getHotTopics();
    res.json(hotTopics);
  } catch (error) {
    // Se l'errore è già formattato (ad es. dal newsService)
    if (error.status && error.message) {
      return res.status(error.status).json({ 
        error: {
          message: error.message,
          code: error.code || 'ERROR'
        }
      });
    }
    
    // Altrimenti, è un errore generico
    logger.error(`Error getting hot topics: ${error.message}`);
    res.status(500).json({ 
      error: { 
        message: 'Si è verificato un errore nel recupero dei topic. Riprova più tardi.',
        code: 'TOPICS_ERROR'
      } 
    });
  }
});

// Get news sources
router.get('/sources', cacheMiddleware(86400), async (req, res, next) => {
  try {
    const sources = newsService.getSources();
    res.json(sources);
  } catch (error) {
    logger.error(`Error getting sources: ${error.message}`);
    res.status(500).json({ 
      error: { 
        message: 'Si è verificato un errore nel recupero delle fonti. Riprova più tardi.',
        code: 'SOURCES_ERROR'
      } 
    });
  }
});

module.exports = router;