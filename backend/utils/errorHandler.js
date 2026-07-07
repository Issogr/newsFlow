/**
 * Utility for standardizing application error handling
 */

const logger = require('./logger');
const { redactUrlForLog } = require('./logRedaction');

function redactSensitiveObject(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.entries(value).reduce((result, [key, entryValue]) => {
    if (/token|authorization|cookie/i.test(key)) {
      result[key] = '[REDACTED]';
      return result;
    }

    result[key] = entryValue;
    return result;
  }, {});
}

/**
 * Maps internal error codes to user-friendly error messages
 */
const ERROR_MESSAGES = {
  'SERVER_ERROR': 'An internal error occurred. Please try again later.',
  'CONNECTION_ERROR': 'Unable to connect to news feeds. Please try again later.',
  'RESOURCE_NOT_FOUND': 'The requested resource was not found',
  'INVALID_ARTICLE_ID': 'Invalid article ID',
  'RATE_LIMIT_EXCEEDED': 'Too many requests. Please try again later.',
  'UNAUTHORIZED': 'You are not authorized to access this resource',
  'FORBIDDEN': 'Access to this resource is denied',
  'INVALID_URL': 'The provided URL is invalid',
  'FORBIDDEN_URL': 'The provided URL cannot be reached by the server'
};

/**
 * Creates a standardized API error object
 * @param {number} status - HTTP status code
 * @param {string} message - Readable error message
 * @param {string} code - Frontend-facing error code
 * @param {Error} originalError - Original error for logging
 * @returns {Object} - Standardized error object
 */
const createError = (status, message, code, originalError = null) => {
  // Log the original error when available
  if (originalError) {
    logger.error(`${code || 'ERROR'}: ${message} - Original error: ${redactUrlForLog(originalError.message)}`, {
      status,
      stack: originalError.stack,
      originalMessage: redactUrlForLog(originalError.message)
    });
  }

  // Use the default message when one exists for the code
  const userMessage = message || ERROR_MESSAGES[code] || 'An internal error occurred.';

  // Create an Error object with custom fields
  const error = new Error(userMessage);
  error.status = status || 500;
  error.code = code || 'SERVER_ERROR';
  
  return error;
};

function buildRateLimitMessage(message) {
  return {
    error: {
      message,
      code: 'RATE_LIMIT_EXCEEDED'
    }
  };
}

/**
 * Middleware for centralized error handling
 */
const errorMiddleware = (err, req, res, next) => {
  // Read error details or fall back to defaults
  const status = err.status || 500;
  const code = err.code || 'SERVER_ERROR';
  
  // Use the custom message or look it up in the error map
  let message = err.message;
  if (!message || (process.env.NODE_ENV === 'production' && status >= 500)) {
    message = ERROR_MESSAGES[code] || 'An internal error occurred.';
  }
  
  // Log the error with request details
  const requestContext = {
    path: req.path,
    method: req.method,
    ip: req.ip,
    query: redactSensitiveObject(req.query),
    params: redactSensitiveObject(req.params),
    userAgent: req.get('user-agent')
  };

  const redactedOriginalUrl = redactUrlForLog(req.originalUrl, { redactAllQuery: true });

  if (status >= 500) {
    logger.error(`${status} - ${redactUrlForLog(err.message || 'Unknown error')} - ${redactedOriginalUrl} - ${req.method} - ${req.ip}`, {
      stack: err.stack,
      request: requestContext
    });
  } else if (status >= 400) {
    logger.warn(`${status} - ${redactUrlForLog(err.message || 'Client error')} - ${redactedOriginalUrl} - ${req.method} - ${req.ip}`, {
      request: requestContext
    });
  }

  // Respond using the standardized error format
  res.status(status).json({
    error: {
      message: message,
      code: code
    }
  });
};

module.exports = {
  createError,
  errorMiddleware,
  buildRateLimitMessage
};
