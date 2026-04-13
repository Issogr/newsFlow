const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const internalApiRoutes = require('./routes/api');
const publicApiRoutes = require('./routes/publicApi');
const logger = require('./utils/logger');
const database = require('./services/database');
const websocketService = require('./services/websocketService');
const newsService = require('./services/newsAggregator');
const rssParser = require('./services/rssParser');
const userService = require('./services/userService');
const { errorMiddleware, createError } = require('./utils/errorHandler');
const { getAllowedOrigins, isOriginAllowed } = require('./utils/networkConfig');

const app = express();
const PORT = process.env.PORT || 5000;
const SERVER_TIMEOUT = parseInt(process.env.SERVER_TIMEOUT || '60000', 10);
const allowedOrigins = getAllowedOrigins();

function redactSensitiveValues(value) {
  return String(value || '').replace(/([?&]token=)[^&\s]+/gi, '$1[REDACTED]');
}

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

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(morgan('combined', {
  stream: { write: (message) => logger.info(redactSensitiveValues(message.trim())) },
  skip: (req) => req.url === '/health'
}));

const baseRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  skip: (req) => req.path === '/health',
  message: {
    error: {
      message: 'Too many requests. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED'
    }
  }
});

function requireInternalAppRequest(req, res, next) {
  const appHeader = String(req.get('x-newsflow-app') || '').trim().toLowerCase();
  const fetchSite = String(req.get('sec-fetch-site') || '').trim().toLowerCase();

  if (appHeader !== 'web') {
    next(createError(404, `Resource not found: ${req.originalUrl}`, 'RESOURCE_NOT_FOUND'));
    return;
  }

  if (fetchSite && fetchSite !== 'same-origin') {
    next(createError(403, 'Origin not allowed', 'FORBIDDEN'));
    return;
  }

  next();
}

app.use('/internal-api', baseRateLimit);
app.use('/internal-api', requireInternalAppRequest);
app.use('/internal-api', internalApiRoutes);
app.use('/api/public', publicApiRoutes);

app.get('/health', (req, res) => {
  const wsStats = websocketService.getStatistics();
  const dbStatus = database.getWriteAccessStatus();

  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    websocket: {
      active: wsStats.activeConnectionsCount,
      total: wsStats.totalConnections
    },
    database: {
      writable: dbStatus.writable,
      checkedAt: dbStatus.checkedAt
    }
  });
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
    logger.warn(`Admin account "${adminBootstrap.user.username}" is not configured. Complete setup before expiry ${adminBootstrap.expiresAt}`);
  }
} catch (error) {
  logger.error(`Startup check failed: ${error.message}`);
  process.exit(1);
}

websocketService.initialize(server);
newsService.startScheduler();

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

server.timeout = SERVER_TIMEOUT;
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

process.on('SIGTERM', () => {
  logger.info('SIGTERM ricevuto. Shutdown graceful in corso...');
  newsService.stopScheduler();
  rssParser.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000);
});

module.exports = server;
