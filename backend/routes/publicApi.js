const express = require('express');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');
const newsService = require('../services/newsAggregator');
const userService = require('../services/userService');
const { asyncHandler } = require('../utils/errorHandler');
const { sanitizeQuery } = require('../utils/inputValidator');
const { resolveOptionalExternalApiPrincipal } = require('../utils/auth');
const { parseNewsQuery } = require('../utils/newsQuery');

const router = express.Router();

const anonymousPublicNewsRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => Boolean(req.externalApi?.authenticated),
  keyGenerator: (req) => {
    return `anon:${ipKeyGenerator(req.ip)}`;
  },
  handler: (req, res) => {
    res.status(429).json({
      error: {
        message: 'Too many anonymous public API requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED'
      }
    });
  },
  message: {
    error: {
      message: 'Too many anonymous public API requests. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED'
    }
  }
});

const authenticatedPublicNewsRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !req.externalApi?.authenticated,
  keyGenerator: (req) => {
    const apiTokenId = req.externalApi?.tokenInfo?.id || '';
    return `token:${apiTokenId}`;
  },
  handler: (req, res) => {
    res.status(429).json({
      error: {
        message: 'Too many authenticated public API requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED'
      }
    });
  },
  message: {
    error: {
      message: 'Too many authenticated public API requests. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED'
    }
  }
});

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

const preAuthPublicNewsRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: {
    error: {
      message: 'Too many public API requests. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED'
    }
  }
});

router.get('/news', [
  preAuthPublicNewsRateLimit,
  resolveOptionalExternalApiPrincipal,
  anonymousPublicNewsRateLimit,
  authenticatedPublicNewsRateLimit,
  sanitizeQuery('search'),
  sanitizeQuery('beforePubDate'),
  sanitizeQuery('beforeId')
], asyncHandler(async (req, res) => {
  const filters = parseNewsQuery(req.query);
  userService.recordPublicApiRequestUsage({
    authenticated: Boolean(req.externalApi?.authenticated),
    userId: req.externalApi?.user?.id || null
  });
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
