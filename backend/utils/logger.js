const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { format } = require('winston');
require('winston-daily-rotate-file');

// Assicurati che la directory dei log esista
const logDir = 'logs';
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Formattazione personalizzata per il console transport
const consoleFormat = format.printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
  return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaStr}`;
});

// Determina il livello di log in base all'ambiente
const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const isTestEnvironment = process.env.NODE_ENV === 'test';

// Configurazione rotazione file di log
const fileRotateTransport = !isTestEnvironment ? new winston.transports.DailyRotateFile({
  filename: path.join(logDir, 'application-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  auditFile: path.join(logDir, 'audit.json'),
  zippedArchive: true
}) : null;

// Configurazione rotazione file di errori
const errorRotateTransport = !isTestEnvironment ? new winston.transports.DailyRotateFile({
  filename: path.join(logDir, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m', 
  maxFiles: '14d',
  level: 'error',
  zippedArchive: true
}) : null;

// Configurazione avanzata di Winston
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
  // Gestione delle eccezioni e dei rifiuti di promessa non gestiti
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

// Aggiungi eventi per gestire errori di scrittura nel file di log
if (!isTestEnvironment) {
  fileRotateTransport.on('error', (error) => {
    console.error('Error writing to log file:', error);
  });

  errorRotateTransport.on('error', (error) => {
    console.error('Error writing to error log file:', error);
  });
}

// Aggiunge supporto per level-based logging methods
logger.verbose = logger.verbose || (message => logger.debug(message));
logger.silly = logger.silly || (message => logger.debug(message));

// Aggiunge un metodo per controllare se un livello è abilitato
logger.isLevelEnabled = (level) => {
  return winston.config.npm.levels[level] <= winston.config.npm.levels[logger.level];
};

// Logging di avvio applicazione
if (!isTestEnvironment) {
  logger.info('Logger initialized with level: ' + LOG_LEVEL);
}

module.exports = logger;
