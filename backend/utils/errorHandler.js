/**
 * Utility per standardizzare la gestione degli errori nell'applicazione
 */

const logger = require('./logger');

/**
 * Mappa i codici di errore interni a messaggi di errore user-friendly
 */
const ERROR_MESSAGES = {
  'SERVER_ERROR': 'Si è verificato un errore interno. Riprova più tardi.',
  'CONNECTION_ERROR': 'Impossibile connettersi ai feed di notizie. Per favore riprova più tardi.',
  'SEARCH_ERROR': 'Si è verificato un errore durante la ricerca. Riprova più tardi.',
  'TOPICS_ERROR': 'Si è verificato un errore nel recupero dei topic. Riprova più tardi.',
  'TOPIC_MAP_ERROR': 'Si è verificato un errore nel recupero delle mappature dei topic.',
  'SOURCES_ERROR': 'Si è verificato un errore nel recupero delle fonti. Riprova più tardi.',
  'MISSING_QUERY': 'È necessario specificare un termine di ricerca',
  'INVALID_SEARCH_QUERY': 'Il termine di ricerca deve contenere almeno 2 caratteri',
  'NO_NEWS_AVAILABLE': 'Nessuna notizia disponibile al momento',
  'RESOURCE_NOT_FOUND': 'La risorsa richiesta non è stata trovata',
  'INVALID_ARTICLE_ID': 'ID articolo non valido',
  'RATE_LIMIT_EXCEEDED': 'Troppe richieste, riprova più tardi',
  'SEARCH_RATE_LIMIT_EXCEEDED': 'Troppe richieste di ricerca, riprova più tardi',
  'REFRESH_RATE_LIMIT_EXCEEDED': 'Troppe richieste di aggiornamento, riprova più tardi',
  'WS_RATE_LIMIT_EXCEEDED': 'Troppe richieste WebSocket, riprova più tardi',
  'VALIDATION_ERROR': 'I dati forniti non sono validi',
  'UNAUTHORIZED': 'Non sei autorizzato ad accedere a questa risorsa',
  'FORBIDDEN': 'Accesso negato a questa risorsa',
  'ADMIN_TOKEN_NOT_CONFIGURED': 'Il token amministrativo non è configurato sul server'
};

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

  // Usa il messaggio predefinito se disponibile per il codice
  const userMessage = message || ERROR_MESSAGES[code] || 'Si è verificato un errore interno.';

  // Crea un oggetto Error con campi personalizzati
  const error = new Error(userMessage);
  error.status = status || 500;
  error.code = code || 'SERVER_ERROR';
  
  return error;
};

/**
 * Middleware per la gestione centralizzata degli errori
 */
const errorMiddleware = (err, req, res, next) => {
  // Recupera informazioni sull'errore o usa default
  const status = err.status || 500;
  const code = err.code || 'SERVER_ERROR';
  
  // Usa messaggio personalizzato o cerca nella mappa errori
  let message = err.message;
  if (!message || process.env.NODE_ENV === 'production') {
    message = ERROR_MESSAGES[code] || 'Si è verificato un errore interno.';
  }
  
  // Log dell'errore con dettagli della richiesta
  const requestContext = {
    path: req.path,
    method: req.method,
    ip: req.ip,
    query: req.query,
    params: req.params,
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

  // Rispondi con formato errore standardizzato
  res.status(status).json({
    error: {
      message: message,
      code: code
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
  Promise.resolve(fn(req, res, next)).catch((error) => {
    // Se l'errore è già in formato API, passalo direttamente
    if (error.status && error.code) {
      next(error);
    } else {
      // Altrimenti crea un errore standard
      next(createError(
        500,
        error.message || 'Si è verificato un errore interno',
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
