import express from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { Request, Response } from 'express';
import database from '../../services/database';
import newsAggregatorQuery from '../../services/newsAggregatorQuery';
import readerService from '../../services/readerService';
import auth from '../../utils/auth';
import { buildRateLimitMessage, createError } from '../../utils/errorHandler';
import inputValidator from '../../utils/inputValidator';
const { ARTICLE_RETENTION_HOURS } = newsAggregatorQuery;
const { requireAuthenticatedUser } = auth;
const { validateAndSanitizeParam } = inputValidator;

const router = express.Router();

const readerRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip || '');
  },
  message: buildRateLimitMessage('Too many reader requests. Please try again shortly.'),
});

router.get('/articles/:articleId/reader', [
  requireAuthenticatedUser,
  readerRateLimit,
  validateAndSanitizeParam('articleId', 'ID articolo non valido')
], async (req: Request, res: Response) => {
  const articleId = req.params.articleId as string;

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

export default router;
