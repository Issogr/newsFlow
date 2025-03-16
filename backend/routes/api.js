const express = require('express');
const router = express.Router();
const newsService = require('../services/newsAggregator');
const topicNormalizer = require('../services/topicNormalizer');
const logger = require('../utils/logger');

// Get all news
router.get('/news', async (req, res, next) => {
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
router.get('/hot-topics', async (req, res, next) => {
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

// Get topics with their variants
router.get('/topics/map', (req, res) => {
  try {
    // Restituisci la mappa di equivalenza dei topic
    res.json({
      topics: Object.keys(topicNormalizer.topicEquivalents),
      mappings: topicNormalizer.topicEquivalents
    });
  } catch (error) {
    logger.error(`Error getting topic mappings: ${error.message}`);
    res.status(500).json({ 
      error: { 
        message: 'Si è verificato un errore nel recupero delle mappature dei topic.',
        code: 'TOPIC_MAP_ERROR'
      } 
    });
  }
});

// Get news sources
router.get('/sources', async (req, res, next) => {
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