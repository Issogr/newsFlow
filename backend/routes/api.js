const express = require('express');
const router = express.Router();
const newsService = require('../services/newsAggregator');
const cache = require('memory-cache');

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
    next(error);
  }
});

// Search news
router.get('/news/search', async (req, res, next) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    const results = await newsService.searchNews(query);
    res.json(results);
  } catch (error) {
    next(error);
  }
});

// Get hot topics
router.get('/hot-topics', cacheMiddleware(1800), async (req, res, next) => {
  try {
    const hotTopics = await newsService.getHotTopics();
    res.json(hotTopics);
  } catch (error) {
    next(error);
  }
});

// Get news sources
router.get('/sources', cacheMiddleware(86400), async (req, res, next) => {
  try {
    const sources = newsService.getSources();
    res.json(sources);
  } catch (error) {
    next(error);
  }
});

module.exports = router;