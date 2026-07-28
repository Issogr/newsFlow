const crypto = require('crypto');
const express = require('express');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');
const newsService = require('../services/newsAggregator');
const userService = require('../services/userService');
const { buildRateLimitMessage, createError } = require('../utils/errorHandler');
const { sanitizeQuery } = require('../utils/inputValidator');
const { extractBearerToken, resolveAuthenticatedApiToken } = require('../utils/auth');
const { parseNewsQuery } = require('../utils/newsQuery');
const { buildUserContext } = require('../utils/userContext');
const {
  isAnonymousPublicApiEnabled,
  isAuthenticatedPublicApiEnabled
} = require('../config/publicApi');

const router = express.Router();
const INVALID_TOKEN_CACHE_MAX_ENTRIES = 1000;
const invalidTokenCache = new Map();

function getBearerTokenCandidate(req) {
  const authorization = String(req.get?.('authorization') || req.headers?.authorization || '').trim();
  return extractBearerToken(authorization);
}

function hashRateLimitToken(value = '') {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function rememberInvalidToken(tokenHash, now = Date.now()) {
  invalidTokenCache.set(tokenHash, now + (15 * 60 * 1000));
  while (invalidTokenCache.size > INVALID_TOKEN_CACHE_MAX_ENTRIES) {
    invalidTokenCache.delete(invalidTokenCache.keys().next().value);
  }
}

function resolveExternalApiPrincipal(req, res, next) {
  const bearerToken = getBearerTokenCandidate(req);
  const tokenHash = bearerToken ? hashRateLimitToken(bearerToken) : '';
  const cachedUntil = tokenHash ? invalidTokenCache.get(tokenHash) : null;

  if (cachedUntil && cachedUntil > Date.now()) {
    req.externalApiAuthError = createError(401, 'API token expired or invalid', 'UNAUTHORIZED');
    next();
    return;
  }
  if (cachedUntil) {
    invalidTokenCache.delete(tokenHash);
  }

  try {
    const resolved = resolveAuthenticatedApiToken({ headers: req.headers || {} });
    req.externalApi = resolved ? {
      authenticated: true,
      token: resolved.token,
      tokenInfo: resolved.tokenRecord,
      user: resolved.user
    } : {
      authenticated: false,
      token: null,
      tokenInfo: null,
      user: null
    };
    next();
  } catch (error) {
    if (tokenHash && error?.status === 401) {
      rememberInvalidToken(tokenHash);
      req.externalApiAuthError = error;
      next();
      return;
    }
    next(error);
  }
}

function rejectInvalidExternalApiToken(req, res, next) {
  next(req.externalApiAuthError);
}

function requirePublicApiModeEnabled(req, res, next) {
  const bearerToken = getBearerTokenCandidate(req);
  const enabled = bearerToken ? isAuthenticatedPublicApiEnabled() : isAnonymousPublicApiEnabled();

  if (enabled) {
    next();
    return;
  }

  next(createError(
    404,
    'Public API access is disabled.',
    'PUBLIC_API_DISABLED'
  ));
}

const anonymousPublicNewsRateLimitMessage = buildRateLimitMessage('Too many anonymous public API requests. Please try again later.');
const authenticatedPublicNewsRateLimitMessage = buildRateLimitMessage('Too many authenticated public API requests. Please try again later.');
const publicNewsRateLimitDefaults = {
  standardHeaders: true,
  legacyHeaders: false,
};

const anonymousPublicNewsRateLimit = rateLimit({
  ...publicNewsRateLimitDefaults,
  windowMs: 60 * 1000,
  max: 30,
  skip: (req) => Boolean(req.externalApi?.authenticated),
  keyGenerator: (req) => {
    return `anon:${ipKeyGenerator(req.ip)}`;
  },
  message: anonymousPublicNewsRateLimitMessage
});

const authenticatedPublicNewsRateLimit = rateLimit({
  ...publicNewsRateLimitDefaults,
  windowMs: 15 * 60 * 1000,
  max: 300,
  skip: (req) => !req.externalApi?.authenticated,
  keyGenerator: (req) => {
    const apiTokenId = req.externalApi?.tokenInfo?.id || '';
    return `token:${apiTokenId}`;
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
  ...publicNewsRateLimitDefaults,
  windowMs: 15 * 60 * 1000,
  max: 1000,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: buildRateLimitMessage('Too many public API requests. Please try again later.')
});

const bearerPublicNewsIpRateLimit = rateLimit({
  ...publicNewsRateLimitDefaults,
  windowMs: 15 * 60 * 1000,
  max: 300,
  skip: (req) => !getBearerTokenCandidate(req),
  keyGenerator: (req) => `bearer-ip:${ipKeyGenerator(req.ip)}`,
  message: buildRateLimitMessage('Too many public API token attempts. Please try again later.')
});

const bearerPublicNewsTokenRateLimit = rateLimit({
  ...publicNewsRateLimitDefaults,
  windowMs: 15 * 60 * 1000,
  max: 30,
  skip: (req) => !getBearerTokenCandidate(req) || Boolean(req.externalApi?.authenticated),
  keyGenerator: (req) => `bearer-token:${ipKeyGenerator(req.ip)}:${hashRateLimitToken(getBearerTokenCandidate(req))}`,
  message: buildRateLimitMessage('Too many public API token attempts. Please try again later.')
});

router.get('/news', [
  requirePublicApiModeEnabled,
  preAuthPublicNewsRateLimit,
  bearerPublicNewsIpRateLimit,
  resolveExternalApiPrincipal,
  bearerPublicNewsTokenRateLimit,
  rejectInvalidExternalApiToken,
  anonymousPublicNewsRateLimit,
  authenticatedPublicNewsRateLimit,
  sanitizeQuery(['search', 'beforePubDate', 'beforeId'])
], async (req, res) => {
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
});

module.exports = router;
