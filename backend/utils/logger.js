const winston = require('winston');
const { format } = require('winston');

// Custom formatting for console output.
const consoleFormat = format.printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
  return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaStr}`;
});

// Resolve the log level from the current environment.
const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const isTestEnvironment = process.env.NODE_ENV === 'test';

function createConsoleTransport({ silent = false } = {}) {
  return new winston.transports.Console({
    silent,
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({
        format: 'HH:mm:ss'
      }),
      consoleFormat
    )
  });
}

// Winston logger configuration.
const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'news-aggregator' },
  transports: [createConsoleTransport({ silent: isTestEnvironment })]
});

let globalErrorHandlersConfigured = false;

function formatUnhandledRejection(reason) {
  if (reason instanceof Error) {
    return {
      message: reason.message,
      stack: reason.stack
    };
  }

  return {
    message: String(reason)
  };
}

function setupGlobalErrorHandlers() {
  if (isTestEnvironment || globalErrorHandlersConfigured) {
    return;
  }

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', {
      message: error?.message || 'Unknown uncaught exception',
      stack: error?.stack
    });
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', formatUnhandledRejection(reason));
  });

  globalErrorHandlersConfigured = true;
}

// Log logger startup once transports are ready.
if (!isTestEnvironment) {
  logger.info('Logger initialized with level: ' + LOG_LEVEL);
}

logger.setupGlobalErrorHandlers = setupGlobalErrorHandlers;

module.exports = logger;
