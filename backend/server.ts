import http = require('http');
const { createApp } = require('./app');
const logger = require('./utils/logger');
const database = require('./services/database');
const websocketService = require('./services/websocketService');
const newsService = require('./services/newsAggregator');
const rssParser = require('./services/rssParser');
const userService = require('./services/userService');
const { parseIntegerEnv } = require('./utils/env');
const { flushApiTokenUsage, startApiTokenUsageFlushTimer, stopApiTokenUsageFlushTimer } = require('./utils/auth');

logger.setupGlobalErrorHandlers();

const app = createApp();
const PORT = process.env.PORT || 5000;
const SERVER_TIMEOUT = parseIntegerEnv('SERVER_TIMEOUT', 60000, { min: 1000 });

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
  websocketService.shutdown(() => {
    if (!server.listening) {
      process.exit(0);
      return;
    }
    server.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export = server;
