const crypto = require('crypto');
const express = require('express');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');
const newsService = require('../services/newsAggregator');
const userService = require('../services/userService');
const { asyncHandler } = require('../utils/errorHandler');
const { sanitizeQuery } = require('../utils/inputValidator');
const { resolveOptionalExternalApiPrincipal } = require('../utils/auth');
const { parseNewsQuery } = require('../utils/newsQuery');
const { buildUserContext } = require('../utils/userContext');

const router = express.Router();

function getBearerTokenCandidate(req) {
  const authorization = String(req.get?.('authorization') || req.headers?.authorization || '').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function hashRateLimitToken(value = '') {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function buildPublicRateLimitMessage(message) {
  return {
    error: {
      message,
      code: 'RATE_LIMIT_EXCEEDED'
    }
  };
}

const anonymousPublicNewsRateLimitMessage = buildPublicRateLimitMessage('Too many anonymous public API requests. Please try again later.');
const authenticatedPublicNewsRateLimitMessage = buildPublicRateLimitMessage('Too many authenticated public API requests. Please try again later.');

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
    res.status(429).json(anonymousPublicNewsRateLimitMessage);
  },
  message: anonymousPublicNewsRateLimitMessage
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
    res.status(429).json(authenticatedPublicNewsRateLimitMessage);
  },
  message: authenticatedPublicNewsRateLimitMessage
});

function getExternalUserContext(req) {
  const userId = req.externalApi?.user?.id;
  if (!userId) {
    return buildUserContext(null);
  }

  const settings = userService.getUserSettings(userId);
  return buildUserContext(userId, settings);
}

const preAuthPublicNewsRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: buildPublicRateLimitMessage('Too many public API requests. Please try again later.')
});

const bearerPublicNewsIpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !getBearerTokenCandidate(req),
  keyGenerator: (req) => `bearer-ip:${ipKeyGenerator(req.ip)}`,
  message: buildPublicRateLimitMessage('Too many public API token attempts. Please try again later.')
});

const bearerPublicNewsTokenRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !getBearerTokenCandidate(req),
  keyGenerator: (req) => `bearer-token:${ipKeyGenerator(req.ip)}:${hashRateLimitToken(getBearerTokenCandidate(req))}`,
  message: buildPublicRateLimitMessage('Too many public API token attempts. Please try again later.')
});

router.get('/news', [
  preAuthPublicNewsRateLimit,
  bearerPublicNewsIpRateLimit,
  bearerPublicNewsTokenRateLimit,
  resolveOptionalExternalApiPrincipal,
  anonymousPublicNewsRateLimit,
  authenticatedPublicNewsRateLimit,
  sanitizeQuery('search'),
  sanitizeQuery('beforePubDate'),
  sanitizeQuery('beforeId')
], asyncHandler(async (req, res) => {
  const filters = parseNewsQuery(req.query);
  const result = await newsService.getCachedNewsFeed(filters, getExternalUserContext(req));
  userService.recordPublicApiRequestUsage({
    authenticated: Boolean(req.externalApi?.authenticated),
    userId: req.externalApi?.user?.id || null
  });

  res.json({
    ...result,
    access: {
      mode: req.externalApi?.authenticated ? 'token' : 'anonymous',
      cachedOnly: true
    }
  });
}));

module.exports = router;
