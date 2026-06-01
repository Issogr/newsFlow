const http = require('http');
const path = require('path');
const { URL } = require('url');
const express = require('express');
const axios = require('axios');
const helmet = require('helmet');

const { createProxyMiddleware } = require('http-proxy-middleware');
const { parseIntegerEnv } = require('./lib/env');
const {
  SESSION_SCHEMA_VERSION,
  clearBffSessionCookie,
  encryptBackendSessionCookie,
  extractBackendSessionCookie,
  getBffSessionSecret,
  getInternalProxyToken
} = require('./lib/sessionPolicy');
const {
  buildSessionMiddleware,
  createSessionStore,
  destroySession,
  destroyStoredSessionsByUserId,
  getBackendSessionCookieFromRequest,
  loadUpgradeSession,
  normalizeSessionState,
  persistSessionUserId,
  renewSessionExpiryIfNeeded,
  upsertStoredSessionUser
} = require('./lib/sessionStore');
const {
  applySanitizedForwardedHeaders,
  buildTrustedForwardedHeaders,
  clearForwardedHeaders,
  copyBackendResponseHeaders,
  extractDeletedAdminUserId
} = require('./lib/proxyHelpers');

const DEFAULT_FRONTEND_DIST_DIR = path.join(__dirname, 'public');
const UPSTREAM_TIMEOUT_MS = parseIntegerEnv('BFF_UPSTREAM_TIMEOUT_MS', 30000, { min: 1000 });
const BACKEND_PROXY_DEFAULTS = {
  changeOrigin: true,
  xfwd: false,
  timeout: UPSTREAM_TIMEOUT_MS,
  proxyTimeout: UPSTREAM_TIMEOUT_MS,
};
const UPSTREAM_ERROR_RESPONSE = {
  error: {
    message: 'Unable to reach the application backend.',
    code: 'BFF_UPSTREAM_ERROR',
  },
};
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function getTrustProxySetting(value = process.env.TRUST_PROXY) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.toLowerCase() === 'false') {
    return false;
  }
  if (normalized.toLowerCase() === 'true') {
    return 1;
  }
  if (/^\d+$/u.test(normalized)) {
    return Number(normalized);
  }

  const entries = normalized.split(',').map((entry) => entry.trim()).filter(Boolean);
  return entries.length > 1 ? entries : normalized;
}

function createApp(options = {}) {
  const backendBaseUrl = String(options.backendBaseUrl || process.env.BACKEND_BASE_URL || 'http://backend:5000').trim().replace(/\/+$/, '');
  const frontendDistDir = options.frontendDistDir || process.env.FRONTEND_DIST_DIR || DEFAULT_FRONTEND_DIST_DIR;
  const internalProxyToken = options.internalProxyToken || getInternalProxyToken();
  const createdSessionStore = options.sessionStoreBundle || createSessionStore(options);
  const sessionStore = createdSessionStore.store;
  const sessionDb = createdSessionStore.db;
  const sessionMiddleware = options.sessionMiddleware || buildSessionMiddleware(sessionStore, getBffSessionSecret());
  const configuredAppOrigin = String(options.appBaseUrl || process.env.APP_BASE_URL || process.env.FRONTEND_BASE_URL || '').trim().replace(/\/+$/, '');
  const backendHttp = options.backendHttp || axios.create({
    baseURL: backendBaseUrl,
    timeout: UPSTREAM_TIMEOUT_MS,
    validateStatus: () => true,
    maxRedirects: 0,
  });
  const app = express();
  const jsonParser = express.json({ limit: '1mb' });

  app.set('trust proxy', getTrustProxySetting());

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
    return {
      'x-newsflow-proxy': internalProxyToken,
      'x-newsflow-service': String(process.env.INTERNAL_SERVICE_NAME || 'bff').trim().toLowerCase() || 'bff',
      ...buildTrustedForwardedHeaders(req, { includeEmpty: true }),
    };
  }

  function stripClientCredentials(proxyReq) {
    proxyReq.removeHeader('authorization');
    proxyReq.removeHeader('x-session-token');
    proxyReq.removeHeader('x-newsflow-app');
  }

  function applyBackendSessionProxyHeaders(proxyReq, req) {
    stripClientCredentials(proxyReq);
    clearForwardedHeaders(proxyReq);
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

  function getExpectedRequestOrigin(req) {
    if (configuredAppOrigin) {
      try {
        return new URL(configuredAppOrigin).origin;
      } catch {
        return configuredAppOrigin;
      }
    }

    return `${req.protocol}://${req.get('host')}`;
  }

  function headerMatchesExpectedOrigin(value, expectedOrigin) {
    if (!value) {
      return false;
    }

    try {
      return new URL(value).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  function requireSameOriginUnsafeRequest(req, res, next) {
    if (SAFE_METHODS.has(String(req.method || '').toUpperCase())) {
      next();
      return;
    }

    const expectedOrigin = getExpectedRequestOrigin(req);
    const origin = req.get('origin');
    const referer = req.get('referer');
    if (headerMatchesExpectedOrigin(origin, expectedOrigin) || (!origin && headerMatchesExpectedOrigin(referer, expectedOrigin))) {
      next();
      return;
    }

    res.status(403).json({
      error: {
        message: 'Cross-origin request rejected.',
        code: 'CSRF_ORIGIN_MISMATCH',
      },
    });
  }

  async function requestInternalBackend(req, pathName, options = {}) {
    return backendHttp.request({
      url: `/internal-api${pathName}`,
      method: options.method || req.method,
      ...(Object.prototype.hasOwnProperty.call(options, 'data') ? { data: options.data } : {}),
      ...(Object.prototype.hasOwnProperty.call(options, 'params') ? { params: options.params } : {}),
      headers: {
        ...buildInternalHeaders(req),
        ...(options.backendSessionCookie ? { Cookie: options.backendSessionCookie } : {}),
      },
    });
  }

  function sendBackendResponse(res, response) {
    copyBackendResponseHeaders(res, response.headers);
    res.status(response.status).send(response.data);
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
    res.end(JSON.stringify(UPSTREAM_ERROR_RESPONSE));
  }

  async function handleSessionAuthRequest(req, res, next, pathName) {
    try {
      const response = await requestInternalBackend(req, pathName, {
        data: req.body || {},
        params: req.query,
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

      sendBackendResponse(res, response);
    } catch (error) {
      next(error);
    }
  }

  function serveSpaIndex(res) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(frontendDistDir, 'index.html'));
  }

  const publicApiProxy = createProxyMiddleware({
    target: `${backendBaseUrl}/api/public`,
    ...BACKEND_PROXY_DEFAULTS,
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.removeHeader('cookie');
        applySanitizedForwardedHeaders(proxyReq, req);
      },
      proxyRes: (proxyRes) => {
        delete proxyRes.headers['set-cookie'];
      },
      error: handleProxyError,
    },
  });

  const appApiProxy = createProxyMiddleware({
    target: `${backendBaseUrl}/internal-api`,
    ...BACKEND_PROXY_DEFAULTS,
    on: {
      proxyReq: (proxyReq, req) => {
        applyBackendSessionProxyHeaders(proxyReq, req);
      },
      proxyRes: (proxyRes, req, res) => {
        delete proxyRes.headers['set-cookie'];

        if (proxyRes.statusCode === 401) {
          clearBffSessionCookie(res);
          destroySession(req, sessionDb).catch(() => {});
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
    ...BACKEND_PROXY_DEFAULTS,
    ws: true,
    pathRewrite: (proxyPath, req) => req.originalUrl || proxyPath,
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
    serveSpaIndex(res);
  });

  app.use(express.static(frontendDistDir, {
    index: false,
    setHeaders: (res, filePath) => {
      const normalizedPath = String(filePath || '').split(path.sep).join('/');
      if (normalizedPath.includes('/assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
        return;
      }

      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    },
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
  app.use(renewSessionExpiryIfNeeded);

  [
    ['/api/auth/register', '/auth/register'],
    ['/api/auth/login', '/auth/login'],
    ['/api/auth/password-setup/complete', '/auth/password-setup/complete']
  ].forEach(([routePath, backendPath]) => {
    app.post(routePath, jsonParser, (req, res, next) => {
      handleSessionAuthRequest(req, res, next, backendPath);
    });
  });

  app.get('/api/auth/password-setup/validate', async (req, res, next) => {
    try {
      const response = await requestInternalBackend(req, '/auth/password-setup/validate', {
        params: req.query,
      });

      sendBackendResponse(res, response);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/me', async (req, res, next) => {
    try {
      const backendSessionCookie = getBackendSessionCookieFromRequest(req);
      const response = await requestInternalBackend(req, '/me', {
        method: 'GET',
        backendSessionCookie,
      });

      if (response.status === 401) {
        await destroySession(req, sessionDb);
        clearBffSessionCookie(res);
      } else {
        await persistSessionUserId(req, response.data?.user?.id || '', sessionDb);
      }

      sendBackendResponse(res, response);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/logout', requireSameOriginUnsafeRequest, async (req, res, next) => {
    const backendSessionCookie = getBackendSessionCookieFromRequest(req);
    let backendResponse = null;

    try {
      if (backendSessionCookie) {
        backendResponse = await requestInternalBackend(req, '/auth/logout', {
          method: 'POST',
          data: {},
          backendSessionCookie,
        });
      }
    } catch {
      backendResponse = null;
    }

    try {
      await destroySession(req, sessionDb);
      clearBffSessionCookie(res);

      if (backendResponse?.status && backendResponse.status < 500) {
        sendBackendResponse(res, backendResponse);
        return;
      }

      res.status(200).json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  app.use('/api', requireBackendSession, requireSameOriginUnsafeRequest, appApiProxy);
  app.use('/socket.io', requireBackendSession, socketProxy);

  app.get(/.*/, (req, res) => {
    serveSpaIndex(res);
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

    res.status(502).json(UPSTREAM_ERROR_RESPONSE);
  });

  return {
    app,
    sessionDb,
    sessionSecret: getBffSessionSecret(),
    sessionStore,
    socketProxy,
  };
}

function createServer(options = {}) {
  const { app, sessionDb, sessionSecret, sessionStore, socketProxy } = createApp(options);
  const server = http.createServer(app);
  let closedResources = false;

  server.on('close', () => {
    if (closedResources) {
      return;
    }

    closedResources = true;
    sessionStore?.stopCleanupInterval?.();
    sessionDb?.close?.();
  });

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
  const port = parseIntegerEnv('PORT', 80, { min: 1, max: 65535 });
  const server = createServer();

  server.listen(port, () => {
    process.stdout.write(`News Flow BFF listening on port ${port}\n`);
  });
}

module.exports = {
  createApp,
  createServer,
  _getTrustProxySetting: getTrustProxySetting
};
