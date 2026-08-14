import http = require('node:http');
import net = require('node:net');
import path = require('node:path');
import compression = require('compression');
import express = require('express');
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import helmet from 'helmet';
import {
  createProxyMiddleware,
  type Options as ProxyOptions,
  type RequestHandler as ProxyRequestHandler,
} from 'http-proxy-middleware';
import type { DatabaseSync } from 'node:sqlite';
import { parseIntegerEnv } from './lib/env';
import {
  SESSION_SCHEMA_VERSION,
  clearBffSessionCookie,
  encryptBackendSessionCookie,
  extractBackendSessionCookie,
  getBffSessionSecret,
  getInternalProxyToken
} from './lib/sessionPolicy';
import {
  buildSessionMiddleware,
  createSessionStore,
  destroySession,
  getBackendSessionCookieFromRequest,
  loadUpgradeSession,
  normalizeSessionState,
  saveExpressSession,
  type CreateSessionStoreOptions,
} from './lib/sessionStore';
import {
  applyProxyRequestHeaders,
  buildTrustedForwardedHeaders,
  copyBackendResponseHeaders,
  getRequestHeader,
  stripBackendCorsResponseHeaders,
  type ProxyRequest,
} from './lib/proxyHelpers';

const packageRoot = path.basename(__dirname) === 'dist' ? path.dirname(__dirname) : __dirname;
const DEFAULT_FRONTEND_DIST_DIR = path.join(packageRoot, 'public');
const UPSTREAM_TIMEOUT_MS = parseIntegerEnv('BFF_UPSTREAM_TIMEOUT_MS', 50000, { min: 1000 });
const READINESS_TIMEOUT_MS = parseIntegerEnv('BFF_READINESS_TIMEOUT_MS', 1000, { min: 100 });
const BACKEND_PROXY_DEFAULTS = {
  changeOrigin: true,
  xfwd: false,
  proxyTimeout: UPSTREAM_TIMEOUT_MS,
};
const UPSTREAM_ERROR_RESPONSE = {
  error: {
    message: 'Unable to reach the application backend.',
    code: 'BFF_UPSTREAM_ERROR',
  },
};
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

interface CreateAppOptions extends CreateSessionStoreOptions {
  appBaseUrl?: string;
  backendBaseUrl?: string;
  frontendDistDir?: string;
}

interface SameOriginOptions {
  allowMissingHeaders?: boolean;
  allowSafeMethods?: boolean;
}

interface InternalBackendRequestOptions {
  backendSessionCookie?: string;
  data?: unknown;
  params?: Record<string, unknown>;
}

interface NormalizedBackendResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  data: unknown;
}

type AppProxyOptions = ProxyOptions<Request, Response>;
type ProxyResponseHandler = NonNullable<NonNullable<AppProxyOptions['on']>['proxyRes']>;

interface BackendProxyOptions {
  includeBackendSession?: boolean;
  onProxyResponse?: ProxyResponseHandler;
  pathRewrite?: AppProxyOptions['pathRewrite'];
  stripSetCookie?: boolean;
  target: string;
  ws?: boolean;
}

export interface CreatedApp {
  app: express.Express;
  sessionDb: DatabaseSync;
  sessionSecret: string;
  sessionStore: ReturnType<typeof createSessionStore>['store'];
  isSameOriginSocketRequest: (req: ProxyRequest) => boolean;
  socketProxy: ProxyRequestHandler<Request, Response>;
}

function getTrustProxySetting(
  value = process.env.TRUST_PROXY,
): boolean | number | string | string[] {
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

function verifySessionStoreWriteAccess(sessionDb: DatabaseSync): void {
  sessionDb.exec('BEGIN IMMEDIATE');
  try {
    sessionDb.prepare(`
      INSERT INTO sessions (sid, sess, expire)
      VALUES ('__readiness__', '{}', ?)
      ON CONFLICT(sid) DO UPDATE SET expire = excluded.expire
    `).run(new Date(Date.now() + 60000).toISOString());
  } finally {
    sessionDb.exec('ROLLBACK');
  }
}

function appendQueryParams(url: URL, params: Record<string, unknown> = {}): void {
  Object.entries(params || {}).forEach(([name, value]) => {
    const values = Array.isArray(value) ? value : [value];
    values.forEach((entry) => {
      if (entry !== undefined && entry !== null) {
        url.searchParams.append(name, String(entry));
      }
    });
  });
}

async function normalizeBackendResponse(response: globalThis.Response): Promise<NormalizedBackendResponse> {
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const headers: Record<string, string | string[] | undefined> = Object.fromEntries(response.headers.entries());
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  let data = text;

  if (setCookies.length > 0) {
    headers['set-cookie'] = setCookies;
  }

  if (text && contentType.includes('application/json')) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return {
    status: response.status,
    headers,
    data,
  };
}

export function createApp(options: CreateAppOptions = {}): CreatedApp {
  const backendBaseUrl = String(options.backendBaseUrl || process.env.BACKEND_BASE_URL || 'http://backend:5000').trim().replace(/\/+$/, '');
  const frontendDistDir = options.frontendDistDir || process.env.FRONTEND_DIST_DIR || DEFAULT_FRONTEND_DIST_DIR;
  const internalProxyToken = getInternalProxyToken();
  const { store: sessionStore, db: sessionDb } = createSessionStore(options);
  const sessionSecret = getBffSessionSecret();
  const sessionMiddleware = buildSessionMiddleware(sessionStore, sessionSecret);
  const configuredAppOrigin = String(options.appBaseUrl || process.env.APP_BASE_URL || process.env.FRONTEND_BASE_URL || '').trim().replace(/\/+$/, '');
  const configuredExpectedOrigin = globalThis.URL.parse(configuredAppOrigin)?.origin || configuredAppOrigin;
  const app = express();
  const jsonParser = express.json({ limit: '1mb' });

  app.set('trust proxy', getTrustProxySetting());

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'same-origin' },
  }));
  app.use(compression({ threshold: 0 }));

  function buildInternalHeaders(req: ProxyRequest): Record<string, string> {
    return {
      'x-newsflow-proxy': internalProxyToken,
      ...buildTrustedForwardedHeaders(req, { includeEmpty: true }),
    };
  }

  function applyBackendSessionProxyHeaders(proxyReq: http.ClientRequest, req: Request): void {
    applyProxyRequestHeaders(proxyReq, req, {
      mode: 'private',
      internalHeaders: buildInternalHeaders(req),
      backendSessionCookie: getBackendSessionCookieFromRequest(req),
    });
  }

  function requireBackendSession(req: Request, res: Response, next: NextFunction): void {
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

  function clearLocalSession(req: Request, res: Response): Promise<void> {
    clearBffSessionCookie(res);
    return destroySession(req);
  }

  function getExpectedRequestOrigin(req: ProxyRequest): string {
    if (configuredAppOrigin) {
      return configuredExpectedOrigin;
    }

    const forwardedProtocol = String(getRequestHeader(req, 'x-forwarded-proto') || '').split(',')[0].trim();
    const protocol = req.protocol || forwardedProtocol || (req.socket?.encrypted ? 'https' : 'http');
    return `${protocol}://${getRequestHeader(req, 'host')}`;
  }

  function headerMatchesExpectedOrigin(value: string | undefined, expectedOrigin: string): boolean {
    return value !== undefined && globalThis.URL.parse(value)?.origin === expectedOrigin;
  }

  function hasSameOriginRequestHeaders(req: ProxyRequest, options: SameOriginOptions = {}): boolean {
    const expectedOrigin = getExpectedRequestOrigin(req);
    const origin = getRequestHeader(req, 'origin');
    const referer = getRequestHeader(req, 'referer');

    return (!origin && !referer && options.allowMissingHeaders === true)
      || headerMatchesExpectedOrigin(origin, expectedOrigin)
      || (!origin && headerMatchesExpectedOrigin(referer, expectedOrigin));
  }

  function sendCrossOriginRejected(res: Response): void {
    res.status(403).json({
      error: {
        message: 'Cross-origin request rejected.',
        code: 'CSRF_ORIGIN_MISMATCH',
      },
    });
  }

  function requireSameOriginRequest(options: SameOriginOptions = {}): RequestHandler {
    return (req, res, next) => {
      const isSafeMethod = options.allowSafeMethods === true && SAFE_METHODS.has(String(req.method || '').toUpperCase());

      if (hasSameOriginRequestHeaders(req, {
        ...options,
        allowMissingHeaders: options.allowMissingHeaders === true || isSafeMethod
      })) {
        next();
        return;
      }

      sendCrossOriginRejected(res);
    };
  }

  const requireSameOriginUnsafeRequest = requireSameOriginRequest({ allowSafeMethods: true });
  const isSameOriginSocketRequest = (req: ProxyRequest): boolean => hasSameOriginRequestHeaders(req, { allowMissingHeaders: true });
  const requireSameOriginSocketRequest = requireSameOriginRequest({ allowMissingHeaders: true });

  async function requestInternalBackend(
    req: Request,
    pathName: string,
    requestOptions: InternalBackendRequestOptions = {},
  ): Promise<NormalizedBackendResponse> {
    const url = new globalThis.URL(`/internal-api${pathName}`, `${backendBaseUrl}/`);
    appendQueryParams(url, requestOptions.params);

    const headers: Record<string, string> = {
      ...buildInternalHeaders(req),
      ...(requestOptions.backendSessionCookie ? { Cookie: requestOptions.backendSessionCookie } : {}),
    };
    const hasData = Object.hasOwn(requestOptions, 'data');
    if (hasData) {
      headers['content-type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
      redirect: 'manual',
      signal: globalThis.AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      ...(hasData ? { body: JSON.stringify(requestOptions.data) } : {}),
    };

    return normalizeBackendResponse(await globalThis.fetch(url, fetchOptions));
  }

  function sendBackendResponse(res: Response, response: NormalizedBackendResponse): void {
    copyBackendResponseHeaders(res, response.headers);
    res.status(response.status).send(response.data);
  }

  function handleProxyError(_error: Error, _req: Request, res?: Response | net.Socket): void {
    if (!res || !('setHeader' in res) || typeof res.setHeader !== 'function' || res.headersSent) {
      res?.destroy?.();
      return;
    }

    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(UPSTREAM_ERROR_RESPONSE));
  }

  function createBackendProxy({
    includeBackendSession = false,
    onProxyResponse,
    pathRewrite,
    stripSetCookie = false,
    target,
    ws = false,
  }: BackendProxyOptions): ProxyRequestHandler<Request, Response> {
    const on: NonNullable<AppProxyOptions['on']> = {
      proxyReq: includeBackendSession
        ? (proxyReq, req) => applyBackendSessionProxyHeaders(proxyReq, req)
        : (proxyReq, req) => applyProxyRequestHeaders(proxyReq, req),
      error: handleProxyError,
    };

    if (stripSetCookie || includeBackendSession || onProxyResponse) {
      on.proxyRes = (proxyRes, req, res) => {
        if (stripSetCookie) {
          delete proxyRes.headers['set-cookie'];
        }
        if (includeBackendSession) {
          stripBackendCorsResponseHeaders(proxyRes.headers);
        }

        onProxyResponse?.(proxyRes, req, res);
      };
    }

    if (ws && includeBackendSession) {
      on.proxyReqWs = (proxyReq, req) => applyBackendSessionProxyHeaders(proxyReq, req);
    }

    return createProxyMiddleware({
      target,
      ...BACKEND_PROXY_DEFAULTS,
      ...(ws ? { ws: true } : {}),
      ...(pathRewrite ? { pathRewrite } : {}),
      on,
    });
  }

  async function handleSessionAuthRequest(req: Request, res: Response, pathName: string): Promise<void> {
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

      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((error) => (error ? reject(error) : resolve()));
      });
      req.session.version = SESSION_SCHEMA_VERSION;
      req.session.backendSessionCookie = encryptBackendSessionCookie(backendSessionCookie);
      await saveExpressSession(req.session);
    }

    sendBackendResponse(res, response);
  }

  function serveSpaIndex(res: Response): void {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(frontendDistDir, 'index.html'));
  }

  const publicApiProxy = createBackendProxy({
    target: `${backendBaseUrl}/api/public`,
    stripSetCookie: true,
  });

  const appApiProxy = createBackendProxy({
    target: `${backendBaseUrl}/internal-api`,
    includeBackendSession: true,
    stripSetCookie: true,
    onProxyResponse: (proxyRes, req, res) => {
      if (proxyRes.statusCode === 401) {
        clearLocalSession(req, res).catch(() => {});
      }
    },
  });

  const socketProxy = createBackendProxy({
    target: backendBaseUrl,
    includeBackendSession: true,
    ws: true,
    pathRewrite: (proxyPath, req) => req.originalUrl || proxyPath,
  });

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/ready', async (req, res) => {
    try {
      verifySessionStoreWriteAccess(sessionDb);
      const response = await globalThis.fetch(`${backendBaseUrl}/ready`, {
        method: 'HEAD',
        redirect: 'manual',
        signal: globalThis.AbortSignal.timeout(READINESS_TIMEOUT_MS)
      });
      if (!response.ok) {
        throw new Error('Backend is not ready');
      }
      res.status(200).json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.use('/api/public', publicApiProxy);

  app.get(['/api', '/api/'], (req, res) => {
    res.redirect(302, '/api/docs');
  });

  app.get(['/api/docs', '/api/docs/'], (req, res) => {
    serveSpaIndex(res);
  });

  app.use(/^\/(?:api|socket\.io).*/u, sessionMiddleware, normalizeSessionState);

  [
    ['/api/auth/register', '/auth/register'],
    ['/api/auth/login', '/auth/login'],
    ['/api/auth/password-setup/complete', '/auth/password-setup/complete']
  ].forEach(([routePath, backendPath]) => {
    app.post(routePath, requireSameOriginUnsafeRequest, jsonParser, (req, res) => handleSessionAuthRequest(req, res, backendPath));
  });

  app.get('/api/auth/password-setup/validate', async (req, res) => {
    const response = await requestInternalBackend(req, '/auth/password-setup/validate', {
      params: req.query,
    });

    sendBackendResponse(res, response);
  });

  app.post('/api/auth/logout', requireSameOriginUnsafeRequest, async (req, res) => {
    const backendSessionCookie = getBackendSessionCookieFromRequest(req);
    let backendResponse = null;

    try {
      if (backendSessionCookie) {
        backendResponse = await requestInternalBackend(req, '/auth/logout', {
          data: {},
          backendSessionCookie,
        });
      }
    } catch {}

    await clearLocalSession(req, res);

    if (backendResponse?.status && backendResponse.status < 500) {
      sendBackendResponse(res, backendResponse);
      return;
    }

    res.status(200).json({ success: true });
  });

  app.use('/api', requireBackendSession, requireSameOriginUnsafeRequest, appApiProxy);
  app.use('/socket.io', requireBackendSession, requireSameOriginSocketRequest, socketProxy);

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

  app.get(/.*/, (req, res) => {
    serveSpaIndex(res);
  });

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error instanceof SyntaxError && 'type' in error && error.type === 'entity.parse.failed') {
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
    sessionSecret,
    sessionStore,
    isSameOriginSocketRequest,
    socketProxy,
  };
}

export function createServer(options: CreateAppOptions = {}): http.Server {
  const { app, isSameOriginSocketRequest, sessionDb, sessionSecret, sessionStore, socketProxy } = createApp(options);
  const server = http.createServer(app);

  server.on('close', () => {
    sessionStore?.stopCleanupInterval?.();
    sessionDb?.close?.();
  });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/socket.io')) {
      socket.destroy();
      return;
    }

    if (!isSameOriginSocketRequest(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    loadUpgradeSession(req, sessionStore, sessionSecret)
      .catch(() => {})
      .finally(() => {
        if (!getBackendSessionCookieFromRequest(req)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }

        socketProxy.upgrade(req as Request, socket as net.Socket, head);
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
