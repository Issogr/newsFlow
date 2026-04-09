const express = require('express');
const rateLimit = require('express-rate-limit');
const newsService = require('../services/newsAggregator');
const userService = require('../services/userService');
const { asyncHandler } = require('../utils/errorHandler');
const { sanitizeQuery } = require('../utils/inputValidator');
const { resolveOptionalExternalApiPrincipal } = require('../utils/auth');

const router = express.Router();

const publicNewsRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const apiTokenId = req.externalApi?.tokenInfo?.id || '';
    return apiTokenId ? `token:${apiTokenId}` : `ip:${req.ip}`;
  },
  message: {
    error: {
      message: 'Too many public API requests. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED'
    }
  }
});

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
    beforePubDate: query.beforePubDate || '',
    beforeId: query.beforeId || '',
    page: query.page ? Number(query.page) : 1,
    pageSize: query.pageSize ? Number(query.pageSize) : 12
  };
}

function getExternalUserContext(req) {
  const userId = req.externalApi?.user?.id;
  if (!userId) {
    return {
      userId: null,
      articleRetentionHours: null,
      excludedSourceIds: [],
      excludedSubSourceIds: []
    };
  }

  const settings = userService.getUserSettings(userId);
  return {
    userId,
    articleRetentionHours: settings.articleRetentionHours,
    excludedSourceIds: settings.excludedSourceIds,
    excludedSubSourceIds: settings.excludedSubSourceIds,
    settings
  };
}

router.get('/news', [
  resolveOptionalExternalApiPrincipal,
  publicNewsRateLimit,
  sanitizeQuery('search'),
  sanitizeQuery('beforePubDate'),
  sanitizeQuery('beforeId')
], asyncHandler(async (req, res) => {
  const filters = parseNewsQuery(req.query);
  const result = await newsService.getCachedNewsFeed(filters, getExternalUserContext(req));

  res.json({
    ...result,
    access: {
      mode: req.externalApi?.authenticated ? 'token' : 'anonymous',
      cachedOnly: true
    }
  });
}));

module.exports = router;
