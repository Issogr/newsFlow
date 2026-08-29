import path = require('node:path');
import cors = require('cors');
import express = require('express');
import helmet from 'helmet';
import morgan = require('morgan');
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
const apiRoutes = require('./routes/api');
const publicApiRoutes = require('./routes/publicApi');
const database = require('./services/database');
const { getTrustProxySetting, requireSameOriginRequest } = require('./utils/browserSecurity');
const { errorMiddleware, createError, buildRateLimitMessage } = require('./utils/errorHandler');
const logger = require('./utils/logger');
const { redactUrlForLog } = require('./utils/logRedaction');
const { getAllowedOrigins, isOriginAllowed } = require('./utils/networkConfig');
const { extractSessionCookie } = require('./utils/auth');
const { clearSessionCookie, getSessionCookieOptions } = require('./utils/sessionCookie');

const packageRoot = path.basename(__dirname) === 'dist' ? path.dirname(__dirname) : __dirname;
const DEFAULT_FRONTEND_DIST_DIR = path.join(packageRoot, 'public');
const SESSION_CREATING_PATHS = new Set([
  '/auth/register',
  '/auth/login',
  '/auth/password-setup/complete',
]);

interface CreateAppOptions {
  frontendDistDir?: string;
}

function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();
  const allowedOrigins = getAllowedOrigins();
  const frontendDistDir = options.frontendDistDir || process.env.FRONTEND_DIST_DIR || DEFAULT_FRONTEND_DIST_DIR;
  const jsonParser = express.json({ limit: '1mb' });
  const urlencodedParser = express.urlencoded({ extended: true, limit: '1mb' });
  const requireSameOriginUnsafeRequest = requireSameOriginRequest({ allowSafeMethods: true });

  // Validate cookie configuration during startup rather than on the first login.
  getSessionCookieOptions();
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

  app.use(morgan('combined', {
    stream: { write: (message) => logger.info(redactUrlForLog(message.trim())) },
    skip: (req) => req.url === '/health',
  }));

  const baseRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip || ''),
    message: buildRateLimitMessage('Too many requests. Please try again later.'),
  });

  const publicCors = cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin, allowedOrigins)) {
        callback(null, true);
        return;
      }
      callback(createError(403, 'Origin not allowed', 'FORBIDDEN'));
    },
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Authorization'],
    maxAge: 86400,
  });

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/ready', (_req, res) => {
    try {
      database.verifyWriteAccess({ maxAgeMs: 5000 });
      res.status(200).json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.use('/api/public', publicCors, publicApiRoutes);
  app.use('/api/public', (req, _res, next) => {
    next(createError(404, `Resource not found: ${req.originalUrl}`, 'RESOURCE_NOT_FOUND'));
  });

  function serveSpaIndex(res: Response): void {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(frontendDistDir, 'index.html'));
  }

  app.get(['/api', '/api/'], (_req, res) => res.redirect(302, '/api/docs'));
  app.get(['/api/docs', '/api/docs/'], (_req, res) => serveSpaIndex(res));

  const browserApiBoundary: RequestHandler = (req, res, next) => {
    const requestPath = req.path.toLowerCase().replace(/\/+$/u, '') || '/';

    if (req.method === 'GET' && requestPath === '/auth/password-setup/validate') {
      next();
      return;
    }

    if (req.method === 'POST' && SESSION_CREATING_PATHS.has(requestPath)) {
      requireSameOriginUnsafeRequest(req, res, next);
      return;
    }

    if (req.method === 'POST' && requestPath === '/auth/logout' && !extractSessionCookie(req.headers.cookie)) {
      requireSameOriginUnsafeRequest(req, res, () => {
        clearSessionCookie(req, res);
        res.status(200).json({ success: true });
      });
      return;
    }

    if (!extractSessionCookie(req.headers.cookie)) {
      clearSessionCookie(req, res);
      next(createError(401, 'Authentication required', 'UNAUTHORIZED'));
      return;
    }

    requireSameOriginUnsafeRequest(req, res, next);
  };

  app.use('/api', baseRateLimit, browserApiBoundary, jsonParser, urlencodedParser, apiRoutes);
  app.use('/api', (req, _res, next) => {
    next(createError(404, `Resource not found: ${req.originalUrl}`, 'RESOURCE_NOT_FOUND'));
  });

  app.use(express.static(frontendDistDir, {
    index: false,
    setHeaders: (res, filePath) => {
      const normalizedPath = String(filePath || '').split(path.sep).join('/');
      res.setHeader(
        'Cache-Control',
        normalizedPath.includes('/assets/')
          ? 'public, max-age=2592000, immutable'
          : 'public, max-age=0, must-revalidate',
      );
    },
  }));

  app.get(/.*/, (_req, res) => serveSpaIndex(res));
  app.use((req, _res, next) => {
    next(createError(404, `Resource not found: ${req.originalUrl}`, 'RESOURCE_NOT_FOUND'));
  });
  app.use((error: unknown, _req: Request, _res: Response, next: NextFunction) => {
    if (error instanceof SyntaxError && 'type' in error && error.type === 'entity.parse.failed') {
      next(createError(400, 'Request body contains malformed JSON.', 'INVALID_JSON'));
      return;
    }
    next(error);
  });
  app.use(errorMiddleware);

  return app;
}

export = { createApp };
