const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const axios = require('axios');
const cookie = require('cookie');
const cookieSignature = require('cookie-signature');
const Database = require('better-sqlite3');
const session = require('express-session');
const SqliteStoreFactory = require('better-sqlite3-session-store')(session);
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

  const SqliteStore = SqliteStoreFactory;
  let cleanupInterval = null;
  const originalSetInterval = global.setInterval;

  global.setInterval = (...args) => {
    const handle = originalSetInterval(...args);
    cleanupInterval = handle;
    return handle;
  };

  let store;

  try {
    store = new SqliteStore({
      client: db,
      expired: {
        clear: true,
        intervalMs: SESSION_STORE_CLEAR_INTERVAL_MS,
      },
    });
  } finally {
    global.setInterval = originalSetInterval;
  }

  cleanupInterval?.unref?.();
  store.stopCleanupInterval = () => {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
  };

  return { store, db };
}

function destroySession(req) {
  if (!req.session) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    req.session.destroy(() => resolve());
  });
}

function isValidSessionPayload(sessionData) {
  if (!sessionData || typeof sessionData !== 'object') {
    return false;
  }

  const backendSessionCookie = String(sessionData.backendSessionCookie || '').trim();
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

function normalizeSessionState(req, res, next) {
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

  destroySession(req).then(() => {
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
  return String(req.session?.backendSessionCookie || '').trim();
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

  app.use(sessionMiddleware);
  app.use(normalizeSessionState);

  function buildInternalHeaders(req) {
    const getHeader = (name) => (
      typeof req.get === 'function'
        ? req.get(name)
        : req.headers?.[String(name || '').toLowerCase()]
    );
    const forwardedFor = String(getHeader('x-forwarded-for') || req.ip || req.socket?.remoteAddress || '').trim();
    const forwardedProto = String(getHeader('x-forwarded-proto') || req.protocol || (req.socket?.encrypted ? 'https' : 'http')).trim();
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
        req.session.backendSessionCookie = backendSessionCookie;
        req.session.createdAt = req.session.createdAt || new Date().toISOString();
        await new Promise((resolve, reject) => {
          req.session.save((error) => (error ? reject(error) : resolve()));
        });
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
    xfwd: true,
    on: {
      proxyReq: (proxyReq) => {
        proxyReq.removeHeader('cookie');
      },
    },
  });

  const appApiProxy = createProxyMiddleware({
    target: `${backendBaseUrl}/internal-api`,
    changeOrigin: false,
    xfwd: true,
    on: {
      proxyReq: (proxyReq, req) => {
        Object.entries(buildInternalHeaders(req)).forEach(([name, value]) => {
          proxyReq.setHeader(name, value);
        });

        proxyReq.removeHeader('authorization');
        proxyReq.removeHeader('x-newsflow-app');

        const backendSessionCookie = getBackendSessionCookieFromRequest(req);
        if (backendSessionCookie) {
          proxyReq.setHeader('cookie', backendSessionCookie);
        } else {
          proxyReq.removeHeader('cookie');
        }
      },
      proxyRes: (proxyRes, req, res) => {
        delete proxyRes.headers['set-cookie'];

        if (proxyRes.statusCode === 401) {
          clearBffSessionCookie(res);
          req.session?.destroy?.(() => {});
        }
      },
    },
  });

  const socketProxy = createProxyMiddleware({
    target: `${backendBaseUrl}/socket.io`,
    changeOrigin: false,
    xfwd: true,
    ws: true,
    on: {
      proxyReq: (proxyReq, req) => {
        Object.entries(buildInternalHeaders(req)).forEach(([name, value]) => {
          proxyReq.setHeader(name, value);
        });

        const backendSessionCookie = getBackendSessionCookieFromRequest(req);
        if (backendSessionCookie) {
          proxyReq.setHeader('cookie', backendSessionCookie);
        } else {
          proxyReq.removeHeader('cookie');
        }
      },
      proxyReqWs: (proxyReq, req) => {
        Object.entries(buildInternalHeaders(req)).forEach(([name, value]) => {
          proxyReq.setHeader(name, value);
        });

        const backendSessionCookie = getBackendSessionCookieFromRequest(req);
        if (backendSessionCookie) {
          proxyReq.setHeader('cookie', backendSessionCookie);
        } else {
          proxyReq.removeHeader('cookie');
        }
      },
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

  app.post('/api/auth/logout', async (req, res, next) => {
    const backendSessionCookie = getBackendSessionCookieFromRequest(req);

    try {
      if (backendSessionCookie) {
        const response = await backendHttp.request({
          url: '/internal-api/auth/logout',
          method: 'POST',
          data: {},
          headers: {
            ...buildInternalHeaders(req),
            Cookie: backendSessionCookie,
          },
        });

        await destroySession(req);
        clearBffSessionCookie(res);
        copyBackendResponseHeaders(res, response.headers);
        res.status(response.status).send(response.data);
        return;
      }

      await destroySession(req);
      clearBffSessionCookie(res);
      res.status(200).json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  app.use('/api', appApiProxy);
  app.use('/socket.io', socketProxy);

  app.use(express.static(frontendDistDir, {
    index: false,
    maxAge: '30d',
    immutable: true,
  }));

  app.get(/.*/, (req, res) => {
    serveSpaIndex(frontendDistDir, res);
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
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
      return;
    }

    loadUpgradeSession(req, sessionStore, sessionSecret)
      .catch(() => null)
      .finally(() => {
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
  getBffSessionSecret,
  getInternalProxyToken,
  isValidSessionPayload,
  parseCookieHeader,
  serializeCookie,
  unsignSessionId,
};
