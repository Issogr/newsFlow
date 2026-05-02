const http = require('http');
const path = require('path');
const express = require('express');
const axios = require('axios');
const helmet = require('helmet');

const { createProxyMiddleware } = require('http-proxy-middleware');
const { parseIntegerEnv } = require('./lib/env');
const {
  BACKEND_SESSION_COOKIE_NAME,
  BFF_SESSION_COOKIE_NAME,
  SESSION_SCHEMA_VERSION,
  clearBffSessionCookie,
  encryptBackendSessionCookie,
  extractBackendSessionCookie,
  getBffSessionSecret,
  getInternalProxyToken,
  isValidSessionPayload,
  parseCookieHeader,
  serializeCookie,
  unsignSessionId
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
  upsertStoredSessionUser
} = require('./lib/sessionStore');
const {
  applySanitizedForwardedHeaders,
  copyBackendResponseHeaders,
  extractDeletedAdminUserId,
  serveSpaIndex
} = require('./lib/proxyHelpers');
const { mapClerkPayloadToIdentity, verifyClerkSessionToken } = require('./lib/clerkAuth');

const DEFAULT_FRONTEND_DIST_DIR = path.join(__dirname, 'public');
const UPSTREAM_TIMEOUT_MS = parseIntegerEnv('BFF_UPSTREAM_TIMEOUT_MS', 30000, { min: 1000 });

function createApp(options = {}) {
  const backendBaseUrl = String(options.backendBaseUrl || process.env.BACKEND_BASE_URL || 'http://backend:5000').trim().replace(/\/+$/, '');
  const frontendDistDir = options.frontendDistDir || process.env.FRONTEND_DIST_DIR || DEFAULT_FRONTEND_DIST_DIR;
  const internalProxyToken = options.internalProxyToken || getInternalProxyToken();
  const createdSessionStore = options.sessionStoreBundle || createSessionStore(options);
  const sessionStore = createdSessionStore.store;
  const sessionDb = createdSessionStore.db;
  const sessionMiddleware = options.sessionMiddleware || buildSessionMiddleware(sessionStore, getBffSessionSecret());
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
        scriptSrc: ["'self'", 'https://*.clerk.accounts.dev', 'https://*.clerk.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'ws:', 'wss:', 'https://*.clerk.accounts.dev', 'https://*.clerk.com'],
        frameSrc: ['https://*.clerk.accounts.dev', 'https://*.clerk.com'],
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
    const forwardedFor = String(req.ip || req.socket?.remoteAddress || '').trim();
    const forwardedProto = req.protocol || (req.socket?.encrypted ? 'https' : 'http');
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
    proxyReq.removeHeader('x-forwarded-for');
    proxyReq.removeHeader('x-forwarded-host');
    proxyReq.removeHeader('x-forwarded-proto');
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

  async function persistBackendSessionFromResponse(req, response) {
    const backendSessionCookie = extractBackendSessionCookie(response.headers['set-cookie']);

    if (!backendSessionCookie) {
      return false;
    }

    req.session.version = SESSION_SCHEMA_VERSION;
    req.session.backendSessionCookie = encryptBackendSessionCookie(backendSessionCookie);
    req.session.userId = response.data?.user?.id || req.session.userId || '';
    req.session.createdAt = req.session.createdAt || new Date().toISOString();
    await new Promise((resolve, reject) => {
      req.session.save((error) => (error ? reject(error) : resolve()));
    });
    upsertStoredSessionUser(sessionDb, req.sessionID, req.session.userId);
    return true;
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

      if (response.status >= 200 && response.status < 300) {
        if (!(await persistBackendSessionFromResponse(req, response))) {
          res.status(502).json({
            error: {
              message: 'Authentication bridge failed to establish a backend session.',
              code: 'BFF_SESSION_ERROR',
            },
          });
          return;
        }
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
    xfwd: false,
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
    changeOrigin: false,
    xfwd: false,
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

  app.post('/api/auth/clerk', jsonParser, async (req, res, next) => {
    try {
      const clerkPayload = await verifyClerkSessionToken(req.body?.token);
      const response = await backendHttp.request({
        url: '/internal-api/auth/clerk',
        method: 'POST',
        data: mapClerkPayloadToIdentity(clerkPayload),
        headers: buildInternalHeaders(req),
      });

      if (response.status >= 200 && response.status < 300) {
        if (!(await persistBackendSessionFromResponse(req, response))) {
          res.status(502).json({
            error: {
              message: 'Authentication bridge failed to establish a backend session.',
              code: 'BFF_SESSION_ERROR',
            },
          });
          return;
        }
      }

      copyBackendResponseHeaders(res, response.headers);
      res.status(response.status).send(response.data);
    } catch (error) {
      res.status(401).json({
        error: {
          message: error.message || 'Invalid Clerk authentication',
          code: 'INVALID_CLERK_AUTH',
        },
      });
    }
  });

  app.post('/api/auth/clerk/merge-local', jsonParser, async (req, res, next) => {
    try {
      const backendSessionCookie = getBackendSessionCookieFromRequest(req);
      if (!backendSessionCookie) {
        clearBffSessionCookie(res);
        res.status(401).json({
          error: {
            message: 'Authentication required',
            code: 'UNAUTHORIZED',
          },
        });
        return;
      }

      const response = await backendHttp.request({
        url: '/internal-api/auth/clerk/merge-local',
        method: 'POST',
        data: req.body || {},
        headers: {
          ...buildInternalHeaders(req),
          Cookie: backendSessionCookie,
        },
      });

      if (response.status >= 200 && response.status < 300) {
        if (!(await persistBackendSessionFromResponse(req, response))) {
          res.status(502).json({
            error: {
              message: 'Authentication bridge failed to establish a backend session.',
              code: 'BFF_SESSION_ERROR',
            },
          });
          return;
        }
      }

      copyBackendResponseHeaders(res, response.headers);
      res.status(response.status).send(response.data);
    } catch (error) {
      next(error);
    }
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
  const port = parseIntegerEnv('PORT', 80, { min: 1, max: 65535 });
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
  encryptBackendSessionCookie,
  getBffSessionSecret,
  getInternalProxyToken,
  isValidSessionPayload,
  parseCookieHeader,
  serializeCookie,
  unsignSessionId,
};
