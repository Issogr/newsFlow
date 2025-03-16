/**
 * Utility per standardizzare la gestione degli errori nell'applicazione
 */

const logger = require('./logger');

/**
 * Crea un oggetto errore standardizzato per l'API
 * @param {number} status - Codice di stato HTTP
 * @param {string} message - Messaggio di errore leggibile
 * @param {string} code - Codice errore per il frontend
 * @param {Error} originalError - Errore originale per il logging
 * @returns {Object} - Oggetto errore standardizzato
 */
const createError = (status, message, code, originalError = null) => {
  // Log dell'errore originale se presente
  if (originalError) {
    logger.error(`${code || 'ERROR'}: ${message} - Original error: ${originalError.message}`, {
      status,
      stack: originalError.stack,
      originalMessage: originalError.message
    });
  }

  return {
    status: status || 500,
    message: message || 'Si è verificato un errore interno.',
    code: code || 'SERVER_ERROR'
  };
};

/**
 * Middleware per la gestione centralizzata degli errori
 */
const errorMiddleware = (err, req, res, next) => {
  // Se l'errore è già formattato secondo il nostro standard
  if (err.status && err.message && err.code) {
    return res.status(err.status).json({
      error: {
        message: err.message,
        code: err.code
      }
    });
  }

  // Altrimenti è un errore non gestito
  const status = err.status || 500;
  const message = process.env.NODE_ENV === 'production' 
    ? 'Si è verificato un errore interno.'
    : err.message || 'Si è verificato un errore interno.';
  
  logger.error(`${status} - ${err.message || 'Unknown error'} - ${req.originalUrl} - ${req.method} - ${req.ip}`, {
    stack: err.stack
  });

  res.status(status).json({
    error: {
      message: message,
      code: 'SERVER_ERROR'
    }
  });
};

/**
 * Wrapper per route handler che cattura automaticamente le eccezioni 
 * e le passa al middleware di gestione degli errori
 * @param {Function} fn - Route handler function
 * @returns {Function} - Route handler con gestione automatica delle eccezioni
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  createError,
  errorMiddleware,
  asyncHandler
};