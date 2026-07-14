const express = require('express');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');
const database = require('../../services/database');
const { ARTICLE_RETENTION_HOURS } = require('../../services/newsAggregatorQuery');
const readerService = require('../../services/readerService');
const { requireAuthenticatedUser } = require('../../utils/auth');
const { buildRateLimitMessage, createError } = require('../../utils/errorHandler');
const { validateAndSanitizeParam } = require('../../utils/inputValidator');

const router = express.Router();

const readerRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip);
  },
  message: buildRateLimitMessage('Too many reader requests. Please try again shortly.'),
});

router.get('/articles/:articleId/reader', [
  requireAuthenticatedUser,
  readerRateLimit,
  validateAndSanitizeParam('articleId', 'ID articolo non valido')
], async (req, res) => {
  const { articleId } = req.params;

  if (articleId.length < 5) {
    throw createError(400, 'ID articolo non valido', 'INVALID_ARTICLE_ID');
  }

  const readerArticle = await readerService.getReaderArticle(articleId, {
    forceRefresh: req.query.refresh === 'true',
    userId: req.user.id,
    maxArticleAgeHours: database.isReadLaterArticle(req.user.id, articleId) ? null : ARTICLE_RETENTION_HOURS
  });

  res.json(readerArticle);
});

module.exports = router;
