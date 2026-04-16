const crypto = require('crypto');
const http = require('http');
const path = require('path');
const express = require('express');
const axios = require('axios');
const { createProxyMiddleware } = require('http-proxy-middleware');

const BACKEND_SESSION_COOKIE_NAME = 'newsflow_session';
const BFF_SESSION_COOKIE_NAME = 'newsflow_bff_session';
const DEFAULT_FRONTEND_DIST_DIR = path.join(__dirname, 'public');
const SESSION_TTL_DAYS = parseInt(process.env.SESSION_TTL_DAYS || '30', 10);
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

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

      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge / 1000))}`);
  }

  if (options.path) {
    parts.push(`Path=${options.path}`);
  }

  if (options.httpOnly) {
    parts.push('HttpOnly');
  }

  if (options.secure) {
    parts.push('Secure');
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  return parts.join('; ');
}

function getCookieOptions(req) {
  const appBaseUrl = String(process.env.APP_BASE_URL || process.env.FRONTEND_BASE_URL || '').trim();
  const forwardedProto = String(req.get('x-forwarded-proto') || '').trim().toLowerCase();
  const secure = process.env.COOKIE_SECURE === 'true'
    || (process.env.COOKIE_SECURE !== 'false' && (appBaseUrl.startsWith('https://') || forwardedProto === 'https' || req.secure));

  return {
    httpOnly: true,
    sameSite: 'Strict',
    secure,
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
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

function createSessionStore() {
  const sessions = new Map();

  function pruneExpiredSessions() {
    const now = Date.now();

    sessions.forEach((session, sessionId) => {
      if (!session || session.expiresAt <= now) {
        sessions.delete(sessionId);
      }
    });
  }

  function create(backendSessionCookie) {
    pruneExpiredSessions();

    const sessionId = crypto.randomBytes(32).toString('base64url');
    sessions.set(sessionId, {
      backendSessionCookie,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });

    return sessionId;
  }

  function touch(sessionId) {
    const session = sessions.get(sessionId);

    if (!session) {
      return null;
    }

    if (session.expiresAt <= Date.now()) {
      sessions.delete(sessionId);
      return null;
    }

    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return session;
  }

  function get(sessionId) {
    if (!sessionId) {
      return null;
    }

    const session = sessions.get(sessionId);

    if (!session) {
      return null;
    }

    if (session.expiresAt <= Date.now()) {
      sessions.delete(sessionId);
      return null;
    }

    return touch(sessionId);
  }

  function remove(sessionId) {
    if (sessionId) {
      sessions.delete(sessionId);
    }
  }

  const pruneTimer = setInterval(pruneExpiredSessions, 5 * 60 * 1000);
  pruneTimer.unref?.();

  return {
    create,
    get,
    touch,
    remove,
    pruneExpiredSessions,
  };
}

function createInternalHeaders(req) {
  const forwardedFor = String(req.get('x-forwarded-for') || req.ip || '').trim();
  const forwardedProto = String(req.get('x-forwarded-proto') || req.protocol || 'http').trim();
  const host = String(req.get('host') || '').trim();

  return {
    'x-newsflow-proxy': String(process.env.INTERNAL_PROXY_TOKEN || 'development-only-change-me').trim(),
    'x-newsflow-service': String(process.env.INTERNAL_SERVICE_NAME || 'bff').trim().toLowerCase() || 'bff',
    'x-forwarded-for': forwardedFor,
    'x-forwarded-proto': forwardedProto,
    'x-forwarded-host': host,
    host,
  };
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

function readBffSessionId(req) {
  const cookies = parseCookieHeader(req.headers.cookie);
  return String(cookies[BFF_SESSION_COOKIE_NAME] || '').trim();
}

function setBffSessionCookie(res, req, sessionId) {
  res.append('Set-Cookie', serializeCookie(BFF_SESSION_COOKIE_NAME, sessionId, getCookieOptions(req)));
}

function clearBffSessionCookie(res, req) {
  res.append('Set-Cookie', serializeCookie(BFF_SESSION_COOKIE_NAME, '', {
    ...getCookieOptions(req),
    maxAge: 0,
  }));
}

function serveSpaIndex(frontendDistDir, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(frontendDistDir, 'index.html'));
}

function createApp(options = {}) {
  const backendBaseUrl = String(options.backendBaseUrl || process.env.BACKEND_BASE_URL || 'http://backend:5000').trim().replace(/\/+$/, '');
  const frontendDistDir = options.frontendDistDir || process.env.FRONTEND_DIST_DIR || DEFAULT_FRONTEND_DIST_DIR;
  const sessionStore = options.sessionStore || createSessionStore();
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

  async function forwardInternalRequest(req, res, { pathName, method = req.method, payload = undefined, params = req.query, backendSessionCookie = '' }) {
    const response = await backendHttp.request({
      url: `/internal-api${pathName}`,
      method,
      params,
      data: payload,
      headers: {
        ...createInternalHeaders(req),
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
        headers: createInternalHeaders(req),
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

        const sessionId = sessionStore.create(backendSessionCookie);
        setBffSessionCookie(res, req, sessionId);
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
        const sessionId = readBffSessionId(req);
        const session = sessionStore.get(sessionId);

        Object.entries(createInternalHeaders(req)).forEach(([name, value]) => {
          proxyReq.setHeader(name, value);
        });

        proxyReq.removeHeader('authorization');
        proxyReq.removeHeader('x-newsflow-app');

        if (session?.backendSessionCookie) {
          proxyReq.setHeader('cookie', session.backendSessionCookie);
        } else {
          proxyReq.removeHeader('cookie');
        }
      },
      proxyRes: (proxyRes, req, res) => {
        delete proxyRes.headers['set-cookie'];

        if (proxyRes.statusCode === 401) {
          const sessionId = readBffSessionId(req);
          sessionStore.remove(sessionId);
          clearBffSessionCookie(res, req);
          return;
        }

        const sessionId = readBffSessionId(req);
        if (sessionStore.get(sessionId)) {
          setBffSessionCookie(res, req, sessionId);
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
        const sessionId = readBffSessionId(req);
        const session = sessionStore.get(sessionId);

        Object.entries(createInternalHeaders(req)).forEach(([name, value]) => {
          proxyReq.setHeader(name, value);
        });

        if (session?.backendSessionCookie) {
          proxyReq.setHeader('cookie', session.backendSessionCookie);
        } else {
          proxyReq.removeHeader('cookie');
        }
      },
      proxyReqWs: (proxyReq, req) => {
        const sessionId = readBffSessionId(req);
        const session = sessionStore.get(sessionId);

        Object.entries(createInternalHeaders(req)).forEach(([name, value]) => {
          proxyReq.setHeader(name, value);
        });

        if (session?.backendSessionCookie) {
          proxyReq.setHeader('cookie', session.backendSessionCookie);
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
    const sessionId = readBffSessionId(req);
    const session = sessionStore.get(sessionId);

    try {
      if (session?.backendSessionCookie) {
        const response = await backendHttp.request({
          url: '/internal-api/auth/logout',
          method: 'POST',
          data: {},
          headers: {
            ...createInternalHeaders(req),
            Cookie: session.backendSessionCookie,
          },
        });

        sessionStore.remove(sessionId);
        clearBffSessionCookie(res, req);
        copyBackendResponseHeaders(res, response.headers);
        res.status(response.status).send(response.data);
      } else {
        sessionStore.remove(sessionId);
        clearBffSessionCookie(res, req);
        res.status(200).json({ success: true });
      }
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
    socketProxy,
    sessionStore,
  };
}

function createServer(options = {}) {
  const { app, socketProxy } = createApp(options);
  const server = http.createServer(app);

  server.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/socket.io')) {
      socketProxy.upgrade(req, socket, head);
    }
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
  createApp,
  createServer,
  createSessionStore,
  extractBackendSessionCookie,
  parseCookieHeader,
  serializeCookie,
};
