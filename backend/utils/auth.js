const crypto = require('crypto');
const { promisify } = require('util');
const database = require('../services/database');
const { createError } = require('./errorHandler');

const SESSION_TTL_DAYS = parseInt(process.env.SESSION_TTL_DAYS || '30', 10);
const API_TOKEN_TTL_DAYS = 30;
const SESSION_PURGE_INTERVAL_MS = parseInt(process.env.SESSION_PURGE_INTERVAL_MS || '300000', 10);
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase() || 'admin';
const USER_ACTIVITY_TOUCH_INTERVAL_SECONDS = parseInt(process.env.USER_ACTIVITY_TOUCH_INTERVAL_SECONDS || '60', 10);
const SESSION_REFRESH_WINDOW_MS = parseInt(process.env.SESSION_REFRESH_WINDOW_MS || String(24 * 60 * 60 * 1000), 10);
const SESSION_COOKIE_NAME = 'newsflow_session';
const scryptAsync = promisify(crypto.scrypt);

let lastSessionPurgeAt = 0;
let lastApiTokenPurgeAt = 0;

function extractBearerToken(authorizationHeader) {
  if (!authorizationHeader || typeof authorizationHeader !== 'string') {
    return '';
  }

  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return '';
  }

  return token.trim();
}

function parseCookieHeader(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return {};
  }

  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex <= 0) {
        return cookies;
      }

      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (!key) {
        return cookies;
      }

      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        return cookies;
      }
      return cookies;
    }, {});
}

function extractSessionCookie(cookieHeader) {
  const cookies = parseCookieHeader(cookieHeader);
  return String(cookies[SESSION_COOKIE_NAME] || '').trim();
}

function safeTokenCompare(expectedToken, receivedToken) {
  if (!expectedToken || !receivedToken) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedToken);
  const receivedBuffer = Buffer.from(receivedToken);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

async function hashPassword(password) {
  const normalized = String(password || '');
  if (!normalized) {
    return null;
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(normalized, salt, 64)).toString('hex');
  return `${salt}:${derivedKey}`;
}

async function verifyPassword(password, storedHash) {
  if (!storedHash) {
    return false;
  }

  const normalized = String(password || '');
  const [salt, derivedKey] = String(storedHash).split(':');

  if (!salt || !derivedKey) {
    return false;
  }

  const candidate = (await scryptAsync(normalized, salt, 64)).toString('hex');
  return safeTokenCompare(derivedKey, candidate);
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createSessionExpiryDate() {
  return new Date(Date.now() + (SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)).toISOString();
}

function shouldRefreshSessionExpiry(expiresAt, now = Date.now()) {
  const expiresAtTime = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresAtTime)) {
    return true;
  }

  return expiresAtTime - now <= SESSION_REFRESH_WINDOW_MS;
}

function createApiTokenExpiryDate() {
  return new Date(Date.now() + (API_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)).toISOString();
}

function resolveAuthenticatedSession({ headers = {}, authToken = '', touchActivitySeconds = USER_ACTIVITY_TOUCH_INTERVAL_SECONDS } = {}) {
  purgeExpiredSessionsIfNeeded();

  const sessionToken = String(authToken || '').trim()
    || extractBearerToken(headers.authorization)
    || extractSessionCookie(headers.cookie)
    || String(headers['x-session-token'] || '').trim();

  if (!sessionToken) {
    throw createError(401, 'Authentication required', 'UNAUTHORIZED');
  }

  const session = database.findSessionByTokenHash(hashSessionToken(sessionToken));
  if (!session || new Date(session.expiresAt) < new Date()) {
    throw createError(401, 'Session expired or invalid', 'UNAUTHORIZED');
  }

  const user = {
    id: session.userId,
    username: session.username,
    isAdmin: String(session.username || '').toLowerCase() === ADMIN_USERNAME,
    sessionToken
  };

  const refreshedExpiresAt = shouldRefreshSessionExpiry(session.expiresAt) ? createSessionExpiryDate() : session.expiresAt;
  if (refreshedExpiresAt !== session.expiresAt) {
    database.refreshSessionExpiry(session.tokenHash, refreshedExpiresAt);
  }
  database.touchUserActivity(user.id, new Date().toISOString(), touchActivitySeconds);

  return {
    sessionToken,
    session: {
      ...session,
      expiresAt: refreshedExpiresAt,
    },
    user
  };
}

function purgeExpiredSessionsIfNeeded(now = Date.now()) {
  if (!Number.isFinite(SESSION_PURGE_INTERVAL_MS) || SESSION_PURGE_INTERVAL_MS <= 0) {
    return 0;
  }

  if ((now - lastSessionPurgeAt) < SESSION_PURGE_INTERVAL_MS) {
    return 0;
  }

  const purgedCount = database.purgeExpiredSessions();
  lastSessionPurgeAt = now;
  return purgedCount;
}

function purgeExpiredApiTokensIfNeeded(now = Date.now()) {
  if (!Number.isFinite(SESSION_PURGE_INTERVAL_MS) || SESSION_PURGE_INTERVAL_MS <= 0) {
    return 0;
  }

  if ((now - lastApiTokenPurgeAt) < SESSION_PURGE_INTERVAL_MS) {
    return 0;
  }

  const purgedCount = database.purgeExpiredApiTokens();
  lastApiTokenPurgeAt = now;
  return purgedCount;
}

function requireAuthenticatedUser(req, res, next) {
  try {
    req.user = resolveAuthenticatedSession({
      headers: req.headers || {},
      touchActivitySeconds: USER_ACTIVITY_TOUCH_INTERVAL_SECONDS
    }).user;

    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAdminUser(req, res, next) {
  if (!req.user) {
    return next(createError(401, 'Authentication required', 'UNAUTHORIZED'));
  }

  if (!req.user.isAdmin) {
    return next(createError(403, 'Admin access required', 'FORBIDDEN'));
  }

  return next();
}

function resolveAuthenticatedApiToken({ headers = {} } = {}) {
  purgeExpiredApiTokensIfNeeded();

  const rawToken = extractBearerToken(headers.authorization);
  if (!rawToken) {
    return null;
  }

  const tokenRecord = database.findActiveApiTokenByHash(hashSessionToken(rawToken));
  if (!tokenRecord || new Date(tokenRecord.expiresAt) < new Date()) {
    throw createError(401, 'API token expired or invalid', 'UNAUTHORIZED');
  }

  database.touchApiTokenUsage(tokenRecord.id, new Date().toISOString());

  return {
    token: rawToken,
    tokenRecord,
    user: {
      id: tokenRecord.userId,
      username: tokenRecord.username,
      isAdmin: String(tokenRecord.username || '').toLowerCase() === ADMIN_USERNAME
    }
  };
}

function resolveOptionalExternalApiPrincipal(req, res, next) {
  try {
    const resolved = resolveAuthenticatedApiToken({
      headers: req.headers || {}
    });

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
    next(error);
  }
}

module.exports = {
  requireAuthenticatedUser,
  requireAdminUser,
  resolveOptionalExternalApiPrincipal,
  resolveAuthenticatedApiToken,
  resolveAuthenticatedSession,
  purgeExpiredSessionsIfNeeded,
  purgeExpiredApiTokensIfNeeded,
  extractBearerToken,
  safeTokenCompare,
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashSessionToken,
  createSessionExpiryDate,
  shouldRefreshSessionExpiry,
  createApiTokenExpiryDate,
  API_TOKEN_TTL_DAYS,
  SESSION_COOKIE_NAME,
  parseCookieHeader,
  extractSessionCookie
};
