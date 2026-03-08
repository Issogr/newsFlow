const crypto = require('crypto');
const database = require('../services/database');
const { createError } = require('./errorHandler');

const SESSION_TTL_DAYS = parseInt(process.env.SESSION_TTL_DAYS || '30', 10);
const SESSION_PURGE_INTERVAL_MS = parseInt(process.env.SESSION_PURGE_INTERVAL_MS || '300000', 10);

let lastSessionPurgeAt = 0;

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

function hashPassword(password) {
  const normalized = String(password || '');
  if (!normalized) {
    return null;
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(normalized, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash) {
    return true;
  }

  const normalized = String(password || '');
  const [salt, derivedKey] = String(storedHash).split(':');

  if (!salt || !derivedKey) {
    return false;
  }

  const candidate = crypto.scryptSync(normalized, salt, 64).toString('hex');
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

function extractSessionToken(req) {
  const headers = req.headers || {};
  return extractBearerToken(headers.authorization) || headers['x-session-token'] || '';
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

function requireAuthenticatedUser(req, res, next) {
  purgeExpiredSessionsIfNeeded();
  const sessionToken = extractSessionToken(req);

  if (!sessionToken) {
    return next(createError(401, 'Authentication required', 'UNAUTHORIZED'));
  }

  const session = database.findSessionByTokenHash(hashSessionToken(sessionToken));
  if (!session || new Date(session.expiresAt) < new Date()) {
    return next(createError(401, 'Session expired or invalid', 'UNAUTHORIZED'));
  }

  req.user = {
    id: session.userId,
    username: session.username,
    sessionToken
  };

  return next();
}

function resetSessionCleanupState() {
  lastSessionPurgeAt = 0;
}

module.exports = {
  requireAuthenticatedUser,
  purgeExpiredSessionsIfNeeded,
  extractBearerToken,
  extractSessionToken,
  safeTokenCompare,
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashSessionToken,
  createSessionExpiryDate,
  _resetSessionCleanupState: resetSessionCleanupState
};
