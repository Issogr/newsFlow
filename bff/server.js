const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const util = require('util');
const express = require('express');
const axios = require('axios');
const cookie = require('cookie');
const cookieSignature = require('cookie-signature');
const helmet = require('helmet');
const Database = require('better-sqlite3');
const session = require('express-session');
const SqliteStoreFactory = require('better-sqlite3-session-store')(session);

util._extend = Object.assign;
const { createProxyMiddleware } = require('http-proxy-middleware');

const BACKEND_SESSION_COOKIE_NAME = 'newsflow_session';
const BFF_SESSION_COOKIE_NAME = 'newsflow_bff_session';
const DEFAULT_FRONTEND_DIST_DIR = path.join(__dirname, 'public');
const DEFAULT_SESSION_DB_PATH = path.join(__dirname, 'data', 'sessions.sqlite');
const SESSION_TTL_DAYS = parseInt(process.env.SESSION_TTL_DAYS || '30', 10);
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const SESSION_STORE_CLEAR_INTERVAL_MS = parseInt(process.env.SESSION_STORE_CLEAR_INTERVAL_MS || '300000', 10);
const SESSION_SCHEMA_VERSION = 1;
const DEFAULT_BFF_SESSION_SECRET = 'development-only-change-me';
const DEFAULT_INTERNAL_PROXY_TOKEN = 'development-only-change-me';
const UPSTREAM_TIMEOUT_MS = parseInt(process.env.BFF_UPSTREAM_TIMEOUT_MS || '30000', 10);

function readConfiguredSecret(name, developmentFallback) {
  const configured = String(process.env[name] || '').trim();
  const isProduction = process.env.NODE_ENV === 'production';

  if (configured) {
    if (isProduction && configured === developmentFallback) {
      throw new Error(`${name} must not use the development default in production.`);
    }

    return configured;
  }

  if (isProduction) {
    throw new Error(`${name} is required in production.`);
  }

  return developmentFallback;
}

function getBffSessionSecret() {
  return readConfiguredSecret('BFF_SESSION_SECRET', DEFAULT_BFF_SESSION_SECRET);
}

function getInternalProxyToken() {
  return readConfiguredSecret('INTERNAL_PROXY_TOKEN', DEFAULT_INTERNAL_PROXY_TOKEN);
}

function getSessionEncryptionKey() {
  return crypto.createHash('sha256').update(getBffSessionSecret()).digest();
}

function encryptBackendSessionCookie(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return '';
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getSessionEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(rawValue, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    'enc',
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

function decryptBackendSessionCookie(value) {
  const storedValue = String(value || '').trim();
  if (!storedValue || !storedValue.startsWith('enc:v1:')) {
    return storedValue;
  }

  const [, , ivValue, tagValue, encryptedValue] = storedValue.split(':');
  if (!ivValue || !tagValue || !encryptedValue) {
    return '';
  }

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getSessionEncryptionKey(), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
}

function parseCookieHeader(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return {};
  }

  return cookie.parse(cookieHeader);
}

function serializeCookie(name, value, options = {}) {
  return cookie.serialize(name, value, options);
}

function getCookieSecureSetting() {
  if (process.env.COOKIE_SECURE === 'true') {
    return true;
  }

  if (process.env.COOKIE_SECURE === 'false') {
    return false;
  }

  return 'auto';
}

function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: getCookieSecureSetting(),
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
}

function getCookieClearOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  };
}

function clearBffSessionCookie(res) {
  res.append('Set-Cookie', serializeCookie(BFF_SESSION_COOKIE_NAME, '', getCookieClearOptions()));
}

function applySanitizedForwardedHeaders(proxyReq, req) {
  proxyReq.removeHeader('x-forwarded-for');
  proxyReq.removeHeader('x-forwarded-host');
  proxyReq.removeHeader('x-forwarded-proto');

  const clientIp = req.socket?.remoteAddress || req.ip;
  if (clientIp) {
    proxyReq.setHeader('X-Forwarded-For', clientIp);
  }

  if (req.headers.host) {
    proxyReq.setHeader('X-Forwarded-Host', req.headers.host);
  }

  proxyReq.setHeader('X-Forwarded-Proto', req.protocol || (req.secure ? 'https' : 'http'));
}

function extractBackendSessionCookie(setCookieHeader) {
  const values = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : (setCookieHeader ? [setCookieHeader] : []);

  const rawCookie = values.find((entry) => String(entry || '').startsWith(`${BACKEND_SESSION_COOKIE_NAME}=`));

  if (!rawCookie) {
    return '';
  }

  return rawCookie.split(';')[0];
}

function copyBackendResponseHeaders(res, headers = {}) {
  Object.entries(headers).forEach(([name, value]) => {
    const lowerName = String(name || '').toLowerCase();

    if (lowerName === 'set-cookie' || lowerName === 'transfer-encoding' || lowerName === 'content-length' || lowerName === 'connection') {
      return;
    }

    if (value !== undefined) {
      res.setHeader(name, value);
    }
  });
}

function serveSpaIndex(frontendDistDir, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(frontendDistDir, 'index.html'));
}

function ensureSessionDbDirectory(sessionDbPath) {
  fs.mkdirSync(path.dirname(sessionDbPath), { recursive: true });
}

function createSessionStore(options = {}) {
  const sessionDbPath = options.sessionDbPath || process.env.BFF_SESSION_DB_PATH || DEFAULT_SESSION_DB_PATH;
  ensureSessionDbDirectory(sessionDbPath);

  const db = new Database(sessionDbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_users (
      sid TEXT PRIMARY KEY,
      user_id TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_session_users_user_id ON session_users (user_id);
  `);

  const BaseSqliteStore = SqliteStoreFactory;
  class ManagedSqliteStore extends BaseSqliteStore {
    startInterval() {
      this.cleanupInterval = setInterval(this.clearExpiredSessions.bind(this), this.expired.intervalMs);
      this.cleanupInterval?.unref?.();
    }

    stopCleanupInterval() {
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }
    }

    clearExpiredSessions() {
      super.clearExpiredSessions();
      cleanupStoredSessionUsers(db);
    }
  }

  const store = new ManagedSqliteStore({
      client: db,
      expired: {
        clear: true,
        intervalMs: SESSION_STORE_CLEAR_INTERVAL_MS,
      },
    });

  return { store, db };
}

function cleanupStoredSessionUsers(sessionDb) {
  if (!sessionDb) {
    return 0;
  }

  return sessionDb.prepare(`
    DELETE FROM session_users
    WHERE NOT EXISTS (
      SELECT 1
      FROM sessions
      WHERE sessions.sid = session_users.sid
    )
  `).run().changes;
}

function destroyStoredSessionsByUserId(sessionStore, sessionDb, userId) {
  if (!sessionStore || !sessionDb || !userId) {
    return 0;
  }

  const matchingSessionIds = sessionDb.prepare(`
    SELECT sid
    FROM session_users
    WHERE user_id = ?
  `).all(userId).map((row) => row.sid);

  matchingSessionIds.forEach((sid) => {
    sessionStore.destroy(sid, () => {});
  });

  sessionDb.prepare('DELETE FROM session_users WHERE user_id = ?').run(userId);

  return matchingSessionIds.length;
}

function upsertStoredSessionUser(sessionDb, sid, userId) {
  if (!sessionDb || !sid || !userId) {
    return;
  }

  sessionDb.prepare(`
    INSERT INTO session_users (sid, user_id)
    VALUES (?, ?)
    ON CONFLICT(sid) DO UPDATE SET user_id = excluded.user_id
  `).run(sid, userId);
}

function removeStoredSessionUser(sessionDb, sid) {
  if (!sessionDb || !sid) {
    return;
  }

  sessionDb.prepare('DELETE FROM session_users WHERE sid = ?').run(sid);
}

function extractDeletedAdminUserId(req, statusCode) {
  if (String(req.method || '').toUpperCase() !== 'DELETE' || statusCode < 200 || statusCode >= 300) {
    return '';
  }

  const rawPath = String(req.originalUrl || req.url || '');
  const match = rawPath.match(/^\/api\/admin\/users\/([^/?#]+)$/);
  return match?.[1] || '';
}

function destroySession(req, sessionDb = null) {
  if (!req.session) {
    return Promise.resolve();
  }

  const sessionId = req.sessionID;

  return new Promise((resolve) => {
    req.session.destroy(() => {
      removeStoredSessionUser(sessionDb, sessionId);
      resolve();
    });
  });
}

function isValidSessionPayload(sessionData) {
  if (!sessionData || typeof sessionData !== 'object') {
    return false;
  }

  const backendSessionCookie = decryptBackendSessionCookie(sessionData.backendSessionCookie || '');
  return sessionData.version === SESSION_SCHEMA_VERSION
    && backendSessionCookie.startsWith(`${BACKEND_SESSION_COOKIE_NAME}=`);
}

function buildSessionMiddleware(store) {
  return session({
    name: BFF_SESSION_COOKIE_NAME,
    store,
    secret: getBffSessionSecret(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    unset: 'destroy',
    cookie: getSessionCookieOptions(),
  });
}

function normalizeSessionState(req, res, next, sessionDb = null) {
  if (!req.session) {
    next();
    return;
  }

  const hasSessionData = Boolean(req.session.version || req.session.backendSessionCookie);
  if (!hasSessionData) {
    next();
    return;
  }

  if (isValidSessionPayload(req.session)) {
    next();
    return;
  }

  destroySession(req, sessionDb).then(() => {
    clearBffSessionCookie(res);
    next();
  });
}

function unsignSessionId(rawCookieValue, secret) {
  const normalized = String(rawCookieValue || '').trim();

  if (!normalized) {
    return '';
  }

  const signedValue = normalized.startsWith('s:') ? normalized.slice(2) : normalized;
  const unsigned = cookieSignature.unsign(signedValue, secret);
  return unsigned === false ? '' : unsigned;
}

function loadUpgradeSession(req, sessionStore, secret) {
  const cookies = parseCookieHeader(req.headers.cookie);
  const sessionId = unsignSessionId(cookies[BFF_SESSION_COOKIE_NAME], secret);

  if (!sessionId) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    sessionStore.get(sessionId, (error, sessionData) => {
      if (error || !isValidSessionPayload(sessionData)) {
        if (sessionData) {
          sessionStore.destroy(sessionId, () => resolve(null));
          return;
        }

        resolve(null);
        return;
      }

      req.session = sessionData;
      req.sessionID = sessionId;
      resolve(sessionData);
    });
  });
}

function getBackendSessionCookieFromRequest(req) {
  return decryptBackendSessionCookie(req.session?.backendSessionCookie || '');
}

async function persistSessionUserId(req, userId, sessionDb = null) {
  if (!req.session || !userId || req.session.userId === userId) {
    if (req.session && userId) {
      upsertStoredSessionUser(sessionDb, req.sessionID, userId);
    }
    return;
  }

  req.session.userId = userId;
  await new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
  upsertStoredSessionUser(sessionDb, req.sessionID, userId);
}

function createApp(options = {}) {
  const backendBaseUrl = String(options.backendBaseUrl || process.env.BACKEND_BASE_URL || 'http://backend:5000').trim().replace(/\/+$/, '');
  const frontendDistDir = options.frontendDistDir || process.env.FRONTEND_DIST_DIR || DEFAULT_FRONTEND_DIST_DIR;
  const internalProxyToken = options.internalProxyToken || getInternalProxyToken();
  const createdSessionStore = options.sessionStoreBundle || createSessionStore(options);
  const sessionStore = createdSessionStore.store;
  const sessionDb = createdSessionStore.db;
  const sessionMiddleware = options.sessionMiddleware || buildSessionMiddleware(sessionStore);
  const backendHttp = options.backendHttp || axios.create({
    baseURL: backendBaseUrl,
    timeout: UPSTREAM_TIMEOUT_MS,
    validateStatus: () => true,
    maxRedirects: 0,
  });
  const app = express();
  const jsonParser = express.json({ limit: '1mb' });

  if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', true);
  } else if (process.env.TRUST_PROXY === 'false') {
    app.set('trust proxy', false);
  } else {
    app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
  }

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'same-origin' },
  }));

  function buildInternalHeaders(req) {
    const getHeader = (name) => (
      typeof req.get === 'function'
        ? req.get(name)
        : req.headers?.[String(name || '').toLowerCase()]
    );
    const forwardedFor = String(Array.isArray(req.ips) && req.ips.length > 0 ? req.ips.join(', ') : (req.ip || req.socket?.remoteAddress || '')).trim();
    const forwardedProto = String(req.protocol || (req.socket?.encrypted ? 'https' : 'http')).trim();
    const host = String(getHeader('host') || '').trim();

    return {
      'x-newsflow-proxy': internalProxyToken,
      'x-newsflow-service': String(process.env.INTERNAL_SERVICE_NAME || 'bff').trim().toLowerCase() || 'bff',
      'x-forwarded-for': forwardedFor,
      'x-forwarded-proto': forwardedProto,
      'x-forwarded-host': host,
      host,
    };
  }

  function stripClientCredentials(proxyReq) {
    proxyReq.removeHeader('authorization');
    proxyReq.removeHeader('x-session-token');
    proxyReq.removeHeader('x-newsflow-app');
  }

  function applyBackendSessionProxyHeaders(proxyReq, req) {
    stripClientCredentials(proxyReq);
    Object.entries(buildInternalHeaders(req)).forEach(([name, value]) => {
      proxyReq.setHeader(name, value);
    });

    const backendSessionCookie = getBackendSessionCookieFromRequest(req);
    if (backendSessionCookie) {
      proxyReq.setHeader('cookie', backendSessionCookie);
    } else {
      proxyReq.removeHeader('cookie');
    }
  }

  function requireBackendSession(req, res, next) {
    if (getBackendSessionCookieFromRequest(req)) {
      next();
      return;
    }

    clearBffSessionCookie(res);
    res.status(401).json({
      error: {
        message: 'Authentication required',
        code: 'UNAUTHORIZED',
      },
    });
  }

  function handleProxyError(error, req, res) {
    if (typeof res?.setHeader !== 'function' || typeof res?.end !== 'function') {
      res?.destroy?.();
      return;
    }

    if (!res || res.headersSent) {
      res?.destroy?.();
      return;
    }

    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      error: {
        message: 'Unable to reach the application backend.',
        code: 'BFF_UPSTREAM_ERROR',
      },
    }));
  }

  async function forwardInternalRequest(req, res, { pathName, method = req.method, payload = undefined, params = req.query, backendSessionCookie = '' }) {
    const response = await backendHttp.request({
      url: `/internal-api${pathName}`,
      method,
      params,
      data: payload,
      headers: {
        ...buildInternalHeaders(req),
        ...(backendSessionCookie ? { Cookie: backendSessionCookie } : {}),
      },
    });

    copyBackendResponseHeaders(res, response.headers);
    res.status(response.status).send(response.data);
    return response;
  }

  async function handleSessionAuthRequest(req, res, next, pathName) {
    try {
      const response = await backendHttp.request({
        url: `/internal-api${pathName}`,
        method: req.method,
        data: req.body || {},
        params: req.query,
        headers: buildInternalHeaders(req),
      });

      const backendSessionCookie = extractBackendSessionCookie(response.headers['set-cookie']);

      if (response.status >= 200 && response.status < 300) {
        if (!backendSessionCookie) {
          res.status(502).json({
            error: {
              message: 'Authentication bridge failed to establish a backend session.',
              code: 'BFF_SESSION_ERROR',
            },
          });
          return;
        }

        req.session.version = SESSION_SCHEMA_VERSION;
        req.session.backendSessionCookie = encryptBackendSessionCookie(backendSessionCookie);
        req.session.userId = response.data?.user?.id || req.session.userId || '';
        req.session.createdAt = req.session.createdAt || new Date().toISOString();
        await new Promise((resolve, reject) => {
          req.session.save((error) => (error ? reject(error) : resolve()));
        });
        upsertStoredSessionUser(sessionDb, req.sessionID, req.session.userId);
      }

      copyBackendResponseHeaders(res, response.headers);
      res.status(response.status).send(response.data);
    } catch (error) {
      next(error);
    }
  }

  const publicApiProxy = createProxyMiddleware({
    target: `${backendBaseUrl}/api/public`,
    changeOrigin: false,
    xfwd: false,
    timeout: UPSTREAM_TIMEOUT_MS,
    proxyTimeout: UPSTREAM_TIMEOUT_MS,
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.removeHeader('cookie');
        applySanitizedForwardedHeaders(proxyReq, req);
      },
      error: handleProxyError,
    },
  });

  const appApiProxy = createProxyMiddleware({
    target: `${backendBaseUrl}/internal-api`,
    changeOrigin: false,
    xfwd: true,
    timeout: UPSTREAM_TIMEOUT_MS,
    proxyTimeout: UPSTREAM_TIMEOUT_MS,
    on: {
      proxyReq: (proxyReq, req) => {
        applyBackendSessionProxyHeaders(proxyReq, req);
      },
      proxyRes: (proxyRes, req, res) => {
        delete proxyRes.headers['set-cookie'];

        if (proxyRes.statusCode === 401) {
          clearBffSessionCookie(res);
          req.session?.destroy?.(() => {});
          return;
        }

        const deletedUserId = extractDeletedAdminUserId(req, proxyRes.statusCode || 0);
        if (deletedUserId) {
          destroyStoredSessionsByUserId(sessionStore, sessionDb, deletedUserId);
        }
      },
      error: handleProxyError,
    },
  });

  const socketProxy = createProxyMiddleware({
    target: backendBaseUrl,
    changeOrigin: false,
    xfwd: true,
    ws: true,
    pathRewrite: (proxyPath, req) => req.originalUrl || proxyPath,
    timeout: UPSTREAM_TIMEOUT_MS,
    proxyTimeout: UPSTREAM_TIMEOUT_MS,
    on: {
      proxyReq: (proxyReq, req) => {
        applyBackendSessionProxyHeaders(proxyReq, req);
      },
      proxyReqWs: (proxyReq, req) => {
        applyBackendSessionProxyHeaders(proxyReq, req);
      },
      error: handleProxyError,
    },
  });

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/public', publicApiProxy);

  app.get(['/api', '/api/'], (req, res) => {
    res.redirect(302, '/api/docs');
  });

  app.get(['/api/docs', '/api/docs/'], (req, res) => {
    serveSpaIndex(frontendDistDir, res);
  });

  app.use(express.static(frontendDistDir, {
    index: false,
    maxAge: '30d',
    immutable: true,
  }));

  app.use((req, res, next) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/socket.io')) {
      next();
      return;
    }

    sessionMiddleware(req, res, next);
  });
  app.use((req, res, next) => {
    if (!req.session) {
      next();
      return;
    }

    normalizeSessionState(req, res, next, sessionDb);
  });

  app.post('/api/auth/register', jsonParser, (req, res, next) => {
    handleSessionAuthRequest(req, res, next, '/auth/register');
  });

  app.post('/api/auth/login', jsonParser, (req, res, next) => {
    handleSessionAuthRequest(req, res, next, '/auth/login');
  });

  app.get('/api/auth/password-setup/validate', async (req, res, next) => {
    try {
      await forwardInternalRequest(req, res, { pathName: '/auth/password-setup/validate' });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/password-setup/complete', jsonParser, (req, res, next) => {
    handleSessionAuthRequest(req, res, next, '/auth/password-setup/complete');
  });

  app.get('/api/me', async (req, res, next) => {
    try {
      const backendSessionCookie = getBackendSessionCookieFromRequest(req);
      const response = await backendHttp.request({
        url: '/internal-api/me',
        method: 'GET',
        headers: {
          ...buildInternalHeaders(req),
          ...(backendSessionCookie ? { Cookie: backendSessionCookie } : {}),
        },
      });

      if (response.status === 401) {
        await destroySession(req, sessionDb);
        clearBffSessionCookie(res);
      } else {
        await persistSessionUserId(req, response.data?.user?.id || '', sessionDb);
      }

      copyBackendResponseHeaders(res, response.headers);
      res.status(response.status).send(response.data);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/logout', async (req, res, next) => {
    const backendSessionCookie = getBackendSessionCookieFromRequest(req);
    let backendResponse = null;

    try {
      if (backendSessionCookie) {
        backendResponse = await backendHttp.request({
          url: '/internal-api/auth/logout',
          method: 'POST',
          data: {},
          headers: {
            ...buildInternalHeaders(req),
            Cookie: backendSessionCookie,
          },
        });
      }
    } catch (error) {
      backendResponse = null;
    }

    try {
      await destroySession(req, sessionDb);
      clearBffSessionCookie(res);

      if (backendResponse?.status && backendResponse.status < 500) {
        copyBackendResponseHeaders(res, backendResponse.headers);
        res.status(backendResponse.status).send(backendResponse.data);
        return;
      }

      res.status(200).json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  app.use('/api', requireBackendSession, appApiProxy);
  app.use('/socket.io', requireBackendSession, socketProxy);

  app.get(/.*/, (req, res) => {
    serveSpaIndex(frontendDistDir, res);
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error instanceof SyntaxError && error.type === 'entity.parse.failed') {
      res.status(400).json({
        error: {
          message: 'Request body contains malformed JSON.',
          code: 'INVALID_JSON',
        },
      });
      return;
    }

    res.status(502).json({
      error: {
        message: 'Unable to reach the application backend.',
        code: 'BFF_UPSTREAM_ERROR',
      },
    });
  });

  return {
    app,
    sessionDb,
    sessionMiddleware,
    sessionSecret: getBffSessionSecret(),
    sessionStore,
    socketProxy,
  };
}

function createServer(options = {}) {
  const { app, sessionSecret, sessionStore, socketProxy } = createApp(options);
  const server = http.createServer(app);

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/socket.io')) {
      socket.destroy();
      return;
    }

    loadUpgradeSession(req, sessionStore, sessionSecret)
      .catch(() => null)
      .finally(() => {
        if (!getBackendSessionCookieFromRequest(req)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }

        socketProxy.upgrade(req, socket, head);
      });
  });

  return server;
}

if (require.main === module) {
  const port = parseInt(process.env.PORT || '80', 10);
  const server = createServer();

  server.listen(port, () => {
    process.stdout.write(`News Flow BFF listening on port ${port}\n`);
  });
}

module.exports = {
  BACKEND_SESSION_COOKIE_NAME,
  BFF_SESSION_COOKIE_NAME,
  SESSION_SCHEMA_VERSION,
  createApp,
  createServer,
  createSessionStore,
  destroyStoredSessionsByUserId,
  getBffSessionSecret,
  getInternalProxyToken,
  isValidSessionPayload,
  parseCookieHeader,
  serializeCookie,
  unsignSessionId,
};
