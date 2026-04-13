/**
 * Utility for standardizing application error handling
 */

const logger = require('./logger');

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
  'SEARCH_ERROR': 'An error occurred while searching. Please try again later.',
  'TOPICS_ERROR': 'An error occurred while loading topics. Please try again later.',
  'TOPIC_MAP_ERROR': 'An error occurred while loading topic mappings.',
  'SOURCES_ERROR': 'An error occurred while loading sources. Please try again later.',
  'MISSING_QUERY': 'A search term is required',
  'INVALID_SEARCH_QUERY': 'The search term must contain at least 2 characters',
  'NO_NEWS_AVAILABLE': 'No news is currently available',
  'RESOURCE_NOT_FOUND': 'The requested resource was not found',
  'INVALID_ARTICLE_ID': 'Invalid article ID',
  'RATE_LIMIT_EXCEEDED': 'Too many requests. Please try again later.',
  'REFRESH_RATE_LIMIT_EXCEEDED': 'Too many refresh requests. Please try again later.',
  'WS_RATE_LIMIT_EXCEEDED': 'Too many WebSocket requests. Please try again later.',
  'VALIDATION_ERROR': 'The provided data is invalid',
  'UNAUTHORIZED': 'You are not authorized to access this resource',
  'FORBIDDEN': 'Access to this resource is denied',
  'ADMIN_TOKEN_NOT_CONFIGURED': 'The admin token is not configured on the server',
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
    logger.error(`${code || 'ERROR'}: ${message} - Original error: ${originalError.message}`, {
      status,
      stack: originalError.stack,
      originalMessage: originalError.message
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

  if (status >= 500) {
    logger.error(`${status} - ${err.message || 'Unknown error'} - ${req.originalUrl} - ${req.method} - ${req.ip}`, {
      stack: err.stack,
      request: requestContext
    });
  } else if (status >= 400) {
    logger.warn(`${status} - ${err.message || 'Client error'} - ${req.originalUrl} - ${req.method} - ${req.ip}`, {
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

/**
 * Wrapper for route handlers that automatically catches exceptions
 * and passes them to the error-handling middleware
 * @param {Function} fn - Route handler function
 * @returns {Function} - Route handler with automatic exception handling
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((error) => {
      // If the error is already in API format, pass it through directly
    if (error.status && error.code) {
      next(error);
    } else {
      // Otherwise create a standard error
      next(createError(
        500,
        error.message || 'An internal error occurred',
        'SERVER_ERROR',
        error
      ));
    }
  });
};

module.exports = {
  createError,
  errorMiddleware,
  asyncHandler,
  ERROR_MESSAGES
};
