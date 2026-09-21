import { formatWithOptions } from 'node:util';

const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const isTestEnvironment = process.env.NODE_ENV === 'test';
const levels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];

function log(level: string, ...args: unknown[]) {
  if (isTestEnvironment || levels.indexOf(level) > levels.indexOf(LOG_LEVEL)) return;
  console.log(`${new Date().toISOString()} [${level.toUpperCase()}]: ${formatWithOptions({ colors: Boolean(process.stdout.isTTY) }, ...args)}`);
}

const logger = {
  log,
  debug: (...args: unknown[]) => log('debug', ...args),
  info: (...args: unknown[]) => log('info', ...args),
  warn: (...args: unknown[]) => log('warn', ...args),
  error: (...args: unknown[]) => log('error', ...args),
  setupGlobalErrorHandlers
};

let globalErrorHandlersConfigured = false;

function formatUnhandledRejection(reason: unknown) {
  if (reason instanceof Error) {
    return {
      errorMessage: reason.message,
      stack: reason.stack
    };
  }

  return {
    errorMessage: String(reason)
  };
}

function isExpectedTimeoutRejection(reason: unknown) {
  const name = String(reason instanceof Error ? reason.name : '').toLowerCase();
  const message = String(reason instanceof Error ? reason.message : reason || '').toLowerCase();

  return name === 'timeouterror' && message.includes('aborted due to timeout');
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
    if (isExpectedTimeoutRejection(reason)) {
      return;
    }

    logger.error('Unhandled promise rejection', formatUnhandledRejection(reason));
  });

  globalErrorHandlersConfigured = true;
}

// Log logger startup once transports are ready.
if (!isTestEnvironment) {
  logger.info('Logger initialized with level: ' + LOG_LEVEL);
}

export default logger;
