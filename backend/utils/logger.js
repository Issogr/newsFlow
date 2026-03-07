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
  transports: [new winston.transports.Console({
    silent: isTestEnvironment,
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({
        format: 'HH:mm:ss'
      }),
      consoleFormat
    )
  })],
  // Handle uncaught exceptions and unhandled promise rejections.
  exceptionHandlers: !isTestEnvironment ? [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({
          format: 'HH:mm:ss'
        }),
        consoleFormat
      )
    })
  ] : [],
  rejectionHandlers: !isTestEnvironment ? [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({
          format: 'HH:mm:ss'
        }),
        consoleFormat
      )
    })
  ] : []
});

// Log logger startup once transports are ready.
if (!isTestEnvironment) {
  logger.info('Logger initialized with level: ' + LOG_LEVEL);
}

module.exports = logger;
