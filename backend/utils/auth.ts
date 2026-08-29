const crypto = require('crypto');
const { promisify } = require('util');
const database = require('../services/database');
const { createError } = require('./errorHandler');
const { parseIntegerEnv } = require('./env');
const { clearSessionCookie, SESSION_COOKIE_NAME, setSessionCookie } = require('./sessionCookie');
import type { IncomingHttpHeaders } from 'node:http';
import type { RequestHandler } from 'express';
import type { ApiTokenRecord, AppError, AuthUser, SessionRecord } from './types';

const SESSION_TTL_DAYS = parseIntegerEnv('SESSION_TTL_DAYS', 30, { min: 1 });
const API_TOKEN_TTL_DAYS = 30;
const SESSION_PURGE_INTERVAL_MS = parseIntegerEnv('SESSION_PURGE_INTERVAL_MS', 300000, { min: 1000 });
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase() || 'admin';
const USER_ACTIVITY_TOUCH_INTERVAL_SECONDS = parseIntegerEnv('USER_ACTIVITY_TOUCH_INTERVAL_SECONDS', 60, { min: 0 });
const SESSION_REFRESH_WINDOW_MS = parseIntegerEnv('SESSION_REFRESH_WINDOW_MS', 24 * 60 * 60 * 1000, { min: 0 });
const API_TOKEN_USAGE_FLUSH_INTERVAL_MS = parseIntegerEnv('API_TOKEN_USAGE_FLUSH_INTERVAL_MS', 5000, { min: 1000 });
const API_TOKEN_USAGE_FLUSH_THRESHOLD = parseIntegerEnv('API_TOKEN_USAGE_FLUSH_THRESHOLD', 50, { min: 1 });
const scryptAsync = promisify(crypto.scrypt);

let lastSessionPurgeAt = 0;
let lastApiTokenPurgeAt = 0;
let pendingApiTokenUsage = new Map<string, string>();
let pendingApiTokenUsageCount = 0;
let lastApiTokenUsageFlushAt = Date.now();
let apiTokenUsageFlushTimer: NodeJS.Timeout | null = null;

function extractBearerToken(authorizationHeader: unknown) {
  if (!authorizationHeader || typeof authorizationHeader !== 'string') {
    return '';
  }

  const match = authorizationHeader.trim().match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function parseCookieHeader(cookieHeader: unknown): Record<string, string> {
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return {};
  }

  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((cookies, part) => {
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

function extractSessionCookie(cookieHeader: unknown) {
  const cookies = parseCookieHeader(cookieHeader);
  return String(cookies[SESSION_COOKIE_NAME] || '').trim();
}

function safeTokenCompare(expectedToken: string, receivedToken: string) {
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

async function hashPassword(password: unknown): Promise<string | null> {
  const normalized = String(password || '');
  if (!normalized) {
    return null;
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(normalized, salt, 64)).toString('hex');
  return `${salt}:${derivedKey}`;
}

async function verifyPassword(password: unknown, storedHash: unknown) {
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

function hashSessionToken(token: unknown) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createSessionExpiryDate() {
  return new Date(Date.now() + (SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)).toISOString();
}

function shouldRefreshSessionExpiry(expiresAt: string, now = Date.now()) {
  const expiresAtTime = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresAtTime)) {
    return true;
  }

  return expiresAtTime - now <= SESSION_REFRESH_WINDOW_MS;
}

function createApiTokenExpiryDate() {
  return new Date(Date.now() + (API_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)).toISOString();
}

function resolveAuthenticatedSession({
  headers = {},
  touchActivitySeconds = USER_ACTIVITY_TOUCH_INTERVAL_SECONDS
}: {
  headers?: IncomingHttpHeaders;
  touchActivitySeconds?: number;
} = {}): { sessionRefreshed: boolean; sessionToken: string; session: SessionRecord; user: AuthUser } {
  purgeExpiredSessionsIfNeeded();

  const sessionToken = extractSessionCookie(headers.cookie);

  if (!sessionToken) {
    throw createError(401, 'Authentication required', 'UNAUTHORIZED');
  }

  const session = database.findSessionByTokenHash(hashSessionToken(sessionToken)) as SessionRecord | null;
  if (!session || new Date(session.expiresAt) < new Date()) {
    throw createError(401, 'Session expired or invalid', 'UNAUTHORIZED');
  }

  const user: AuthUser = {
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
    sessionRefreshed: refreshedExpiresAt !== session.expiresAt,
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

function flushApiTokenUsage({ force = false }: { force?: boolean } = {}) {
  if (pendingApiTokenUsageCount <= 0) {
    return 0;
  }

  const now = Date.now();
  if (
    !force
    && pendingApiTokenUsageCount < API_TOKEN_USAGE_FLUSH_THRESHOLD
    && now - lastApiTokenUsageFlushAt < API_TOKEN_USAGE_FLUSH_INTERVAL_MS
  ) {
    return 0;
  }

  const pendingEntries = [...pendingApiTokenUsage.entries()];
  const flushedCount = pendingApiTokenUsageCount;

  pendingApiTokenUsage = new Map<string, string>();
  pendingApiTokenUsageCount = 0;
  lastApiTokenUsageFlushAt = now;

  try {
    pendingEntries.forEach(([tokenId, usedAt]) => {
      database.touchApiTokenUsage(tokenId, usedAt);
    });
  } catch (error) {
    pendingEntries.forEach(([tokenId, usedAt]) => {
      const currentUsedAt = pendingApiTokenUsage.get(tokenId);
      pendingApiTokenUsage.set(tokenId, currentUsedAt && currentUsedAt > usedAt ? currentUsedAt : usedAt);
      pendingApiTokenUsageCount += 1;
    });
    throw error;
  }

  return flushedCount;
}

function recordApiTokenUsage(tokenId: string, usedAt = new Date().toISOString()) {
  if (!tokenId) {
    return;
  }

  const currentUsedAt = pendingApiTokenUsage.get(tokenId);
  pendingApiTokenUsage.set(tokenId, currentUsedAt && currentUsedAt > usedAt ? currentUsedAt : usedAt);
  pendingApiTokenUsageCount += 1;
  flushApiTokenUsage();
}

function startApiTokenUsageFlushTimer() {
  if (apiTokenUsageFlushTimer || !Number.isFinite(API_TOKEN_USAGE_FLUSH_INTERVAL_MS) || API_TOKEN_USAGE_FLUSH_INTERVAL_MS <= 0) {
    return null;
  }

  apiTokenUsageFlushTimer = setInterval(() => {
    try {
      flushApiTokenUsage({ force: true });
    } catch {
      // Keep buffered usage in memory; the next tick or shutdown flush can retry.
    }
  }, API_TOKEN_USAGE_FLUSH_INTERVAL_MS);
  apiTokenUsageFlushTimer.unref?.();
  return apiTokenUsageFlushTimer;
}

function stopApiTokenUsageFlushTimer() {
  if (!apiTokenUsageFlushTimer) {
    return;
  }

  clearInterval(apiTokenUsageFlushTimer);
  apiTokenUsageFlushTimer = null;
}

const requireAuthenticatedUser: RequestHandler = (req, res, next) => {
  try {
    const resolved = resolveAuthenticatedSession({
      headers: req.headers || {},
      touchActivitySeconds: USER_ACTIVITY_TOUCH_INTERVAL_SECONDS
    });
    req.user = resolved.user;
    if (resolved.sessionRefreshed) {
      setSessionCookie(req, res, resolved.sessionToken);
    }

    return next();
  } catch (error) {
    if ((error as AppError).status === 401) {
      clearSessionCookie(req, res);
    }
    return next(error);
  }
};

const requireAdminUser: RequestHandler = (req, res, next) => {
  if (!req.user) {
    return next(createError(401, 'Authentication required', 'UNAUTHORIZED'));
  }

  if (!req.user.isAdmin) {
    return next(createError(403, 'Admin access required', 'FORBIDDEN'));
  }

  return next();
};

function resolveAuthenticatedApiToken({ headers = {} }: { headers?: IncomingHttpHeaders } = {}): {
  token: string;
  tokenRecord: ApiTokenRecord;
  user: AuthUser;
} | null {
  purgeExpiredApiTokensIfNeeded();

  const rawToken = extractBearerToken(headers.authorization);
  if (!rawToken) {
    return null;
  }

  const tokenRecord = database.findActiveApiTokenByHash(hashSessionToken(rawToken)) as ApiTokenRecord | null;
  if (!tokenRecord || new Date(tokenRecord.expiresAt) < new Date()) {
    throw createError(401, 'API token expired or invalid', 'UNAUTHORIZED');
  }

  recordApiTokenUsage(tokenRecord.id, new Date().toISOString());

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

export = {
  requireAuthenticatedUser,
  requireAdminUser,
  resolveAuthenticatedApiToken,
  resolveAuthenticatedSession,
  purgeExpiredSessionsIfNeeded,
  flushApiTokenUsage,
  startApiTokenUsageFlushTimer,
  stopApiTokenUsageFlushTimer,
  extractBearerToken,
  safeTokenCompare,
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashSessionToken,
  createSessionExpiryDate,
  createApiTokenExpiryDate,
  API_TOKEN_TTL_DAYS,
  SESSION_COOKIE_NAME,
  extractSessionCookie
};
