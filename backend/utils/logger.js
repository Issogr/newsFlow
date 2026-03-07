const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { format } = require('winston');
require('winston-daily-rotate-file');

// Ensure the log directory exists.
const logDir = 'logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Custom formatting for console output.
const consoleFormat = format.printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
  return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaStr}`;
});

// Resolve the log level from the current environment.
const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const isTestEnvironment = process.env.NODE_ENV === 'test';

// Application log rotation.
const fileRotateTransport = !isTestEnvironment ? new winston.transports.DailyRotateFile({
  filename: path.join(logDir, 'application-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  auditFile: path.join(logDir, 'audit.json'),
  zippedArchive: true
}) : null;

// Error log rotation.
const errorRotateTransport = !isTestEnvironment ? new winston.transports.DailyRotateFile({
  filename: path.join(logDir, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m', 
  maxFiles: '14d',
  level: 'error',
  zippedArchive: true
}) : null;

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
  transports: [
    ...(!isTestEnvironment ? [fileRotateTransport, errorRotateTransport] : []),
    new winston.transports.Console({
      silent: isTestEnvironment,
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({
          format: 'HH:mm:ss'
        }),
        consoleFormat
      )
    })
  ],
  // Handle uncaught exceptions and unhandled promise rejections.
  exceptionHandlers: !isTestEnvironment ? [
    new winston.transports.DailyRotateFile({
      filename: path.join(logDir, 'exceptions-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true
    }),
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
    new winston.transports.DailyRotateFile({
      filename: path.join(logDir, 'rejections-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true
    }),
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

// Report file transport write errors.
if (!isTestEnvironment) {
  fileRotateTransport.on('error', (error) => {
    console.error('Error writing to log file:', error);
  });

  errorRotateTransport.on('error', (error) => {
    console.error('Error writing to error log file:', error);
  });
}

// Log logger startup once transports are ready.
if (!isTestEnvironment) {
  logger.info('Logger initialized with level: ' + LOG_LEVEL);
}

module.exports = logger;
