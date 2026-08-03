import http = require('http');
import express = require('express');
import cors = require('cors');
import helmet from 'helmet';
import morgan = require('morgan');
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { RequestHandler } from 'express';
const internalApiRoutes = require('./routes/api');
const publicApiRoutes = require('./routes/publicApi');
const logger = require('./utils/logger');
const database = require('./services/database');
const websocketService = require('./services/websocketService');
const newsService = require('./services/newsAggregator');
const rssParser = require('./services/rssParser');
const userService = require('./services/userService');
const { errorMiddleware, createError, buildRateLimitMessage } = require('./utils/errorHandler');
const { parseIntegerEnv } = require('./utils/env');
const { getAllowedOrigins, isOriginAllowed } = require('./utils/networkConfig');
const { hasTrustedInternalService } = require('./utils/internalRequestGate');
const { redactUrlForLog } = require('./utils/logRedaction');
const { flushApiTokenUsage, startApiTokenUsageFlushTimer, stopApiTokenUsageFlushTimer } = require('./utils/auth');

const app = express();
const PORT = process.env.PORT || 5000;
const SERVER_TIMEOUT = parseIntegerEnv('SERVER_TIMEOUT', 60000, { min: 1000 });
const allowedOrigins = getAllowedOrigins();
const jsonParser = express.json({ limit: '1mb' });
const urlencodedParser = express.urlencoded({ extended: true, limit: '1mb' });

logger.setupGlobalErrorHandlers();

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
      objectSrc: ["'none'"]
    }
  },
  referrerPolicy: { policy: 'same-origin' }
}));

app.use(cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin, allowedOrigins)) {
      callback(null, true);
      return;
    }

    callback(createError(403, 'Origin not allowed', 'FORBIDDEN'));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400
}));

app.use(morgan('combined', {
  stream: { write: (message) => logger.info(redactUrlForLog(message.trim())) },
  skip: (req) => req.url === '/health'
}));

const baseRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip || ''),
  skip: (req) => req.path === '/health',
  message: buildRateLimitMessage('Too many requests. Please try again later.')
});

const requireInternalAppRequest: RequestHandler = (req, res, next) => {
  if (!hasTrustedInternalService(req.headers)) {
    next(createError(404, `Resource not found: ${req.originalUrl}`, 'RESOURCE_NOT_FOUND'));
    return;
  }

  next();
};

app.use('/internal-api', baseRateLimit);
app.use('/internal-api', requireInternalAppRequest);
app.use('/internal-api', jsonParser, urlencodedParser, internalApiRoutes);
app.use('/api/public', publicApiRoutes);

app.get('/health', (req, res) => {
  const wsStats = websocketService.getStatistics();

  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    websocket: {
      active: wsStats.activeConnectionsCount,
      total: wsStats.totalConnections
    }
  });
});

app.get('/ready', (req, res) => {
  try {
    const dbStatus = database.verifyWriteAccess({ maxAgeMs: 5000 });
    res.status(200).json({ status: 'ok', database: dbStatus });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});

app.use((req, res, next) => {
  next(createError(404, `Resource not found: ${req.originalUrl}`, 'RESOURCE_NOT_FOUND'));
});

app.use(errorMiddleware);

const server = http.createServer(app);
try {
  const dbWriteStatus = database.verifyWriteAccess();
  logger.info(`Database write check passed at ${dbWriteStatus.checkedAt}`);

  const adminBootstrap = userService.ensureAdminBootstrap();
  if (adminBootstrap.required) {
    logger.warn(`Admin account "${adminBootstrap.user.username}" is not configured. Complete setup before expiry ${adminBootstrap.expiresAt}.`);
  }
} catch (error) {
  logger.error(`Startup check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

websocketService.initialize(server);
newsService.startScheduler();
userService.startPublicApiUsageFlushTimer();
startApiTokenUsageFlushTimer();
let shuttingDown = false;

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

server.timeout = SERVER_TIMEOUT;
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info(`${signal} ricevuto. Shutdown graceful in corso...`);
  newsService.stopScheduler();
  userService.stopPublicApiUsageFlushTimer();
  stopApiTokenUsageFlushTimer();
  try {
    userService.flushAnonymousPublicApiUsage({ force: true });
    flushApiTokenUsage({ force: true });
  } catch (error) {
    logger.warn(`Public API usage flush failed during shutdown: ${error instanceof Error ? error.message : String(error)}`);
  }
  rssParser.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export = server;
