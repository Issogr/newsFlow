const express = require('express');
const newsService = require('../services/newsAggregator');
const readerService = require('../services/readerService');
const websocketService = require('../services/websocketService');
const { asyncHandler, createError } = require('../utils/errorHandler');
const { sanitizeParam, sanitizeQuery, validateParam, validateQueryParam } = require('../utils/inputValidator');
const { requireAdminToken } = require('../utils/auth');

const router = express.Router();

function parseCsvParam(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNewsQuery(query = {}) {
  return {
    search: query.search || '',
    sourceIds: parseCsvParam(query.sources),
    topics: parseCsvParam(query.topics),
    recentHours: query.recentHours ? Number(query.recentHours) : null,
    page: query.page ? Number(query.page) : 1,
    pageSize: query.pageSize ? Number(query.pageSize) : 12
  };
}

router.get('/news', [sanitizeQuery('search')], asyncHandler(async (req, res) => {
  const filters = parseNewsQuery(req.query);
  const result = await newsService.getNewsFeed(filters);
  res.json(result);
}));

router.get('/news/search', [
  validateQueryParam('query', 'È necessario specificare un termine di ricerca'),
  sanitizeQuery('query')
], asyncHandler(async (req, res) => {
  const { query } = req.query;
  const filters = parseNewsQuery(req.query);
  const result = await newsService.searchNews(query, filters);
  res.json(result);
}));

router.get('/hot-topics', asyncHandler(async (req, res) => {
  res.json(await newsService.getHotTopics());
}));

router.get('/sources', asyncHandler(async (req, res) => {
  res.json(newsService.getSources());
}));

router.get('/articles/:articleId/topics', [
  validateParam('articleId', 'ID articolo non valido'),
  sanitizeParam('articleId')
], asyncHandler(async (req, res) => {
  const { articleId } = req.params;
  if (articleId.length < 5) {
    throw createError(400, 'ID articolo non valido', 'INVALID_ARTICLE_ID');
  }

  res.json({
    articleId,
    topics: newsService.getArticleTopics(articleId)
  });
}));

router.get('/articles/:articleId/reader', [
  validateParam('articleId', 'ID articolo non valido'),
  sanitizeParam('articleId')
], asyncHandler(async (req, res) => {
  const { articleId } = req.params;

  if (articleId.length < 5) {
    throw createError(400, 'ID articolo non valido', 'INVALID_ARTICLE_ID');
  }

  const readerArticle = await readerService.getReaderArticle(articleId, {
    forceRefresh: req.query.refresh === 'true'
  });

  res.json(readerArticle);
}));

router.post('/refresh', requireAdminToken, asyncHandler(async (req, res) => {
  const result = await newsService.forceRefresh();
  res.json({
    success: true,
    message: 'Dati aggiornati con successo',
    ...result
  });
}));

router.get('/ws/status', (req, res) => {
  res.json(websocketService.getStatistics());
});

router.post('/ws/notify', requireAdminToken, [
  validateQueryParam('message', 'Messaggio richiesto'),
  sanitizeQuery('message')
], asyncHandler(async (req, res) => {
  const message = req.query.message;
  const type = req.query.type || 'info';

  if (!['info', 'warning', 'error'].includes(type)) {
    throw createError(400, 'Tipo di notifica non valido', 'INVALID_NOTIFICATION_TYPE');
  }

  websocketService.broadcastSystemNotification(message, type);
  res.json({ success: true, message: 'Notifica inviata con successo', type });
}));

module.exports = router;
