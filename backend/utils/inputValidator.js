/**
 * Modulo per la validazione e sanitizzazione degli input
 */

const createError = require('./errorHandler').createError;
const logger = require('./logger');

/**
 * Sanitizza una stringa per prevenire XSS e injection
 * @param {string} input - Input da sanitizzare
 * @returns {string} - Input sanitizzato
 */
function sanitizeString(input) {
  if (typeof input !== 'string') {
    return '';
  }
  
  // Rimuovi tag HTML, script e caratteri potenzialmente dannosi
  return input
    .replace(/<(script|style|iframe|object|embed|form|meta)[^>]*?>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .replace(/data:/gi, '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'");
}

/**
 * Middleware per validare un parametro di query
 * @param {string} paramName - Nome del parametro da validare
 * @param {string} errorMessage - Messaggio di errore
 * @returns {Function} - Middleware Express
 */
function validateQueryParam(paramName, errorMessage = 'Parametro mancante o non valido') {
  return (req, res, next) => {
    if (!req.query[paramName]) {
      return next(createError(400, errorMessage, 'MISSING_PARAM'));
    }
    next();
  };
}

/**
 * Middleware per validare un parametro di route
 * @param {string} paramName - Nome del parametro da validare
 * @param {string} errorMessage - Messaggio di errore
 * @returns {Function} - Middleware Express
 */
function validateParam(paramName, errorMessage = 'Parametro mancante o non valido') {
  return (req, res, next) => {
    if (!req.params[paramName]) {
      return next(createError(400, errorMessage, 'MISSING_PARAM'));
    }
    next();
  };
}

/**
 * Middleware per sanitizzare un parametro di query
 * @param {string} paramName - Nome del parametro da sanitizzare
 * @returns {Function} - Middleware Express
 */
function sanitizeQuery(paramName) {
  return (req, res, next) => {
    if (req.query[paramName]) {
      req.query[paramName] = sanitizeString(req.query[paramName]);
    }
    next();
  };
}

/**
 * Middleware per sanitizzare un parametro di route
 * @param {string} paramName - Nome del parametro da sanitizzare
 * @returns {Function} - Middleware Express
 */
function sanitizeParam(paramName) {
  return (req, res, next) => {
    if (req.params[paramName]) {
      req.params[paramName] = sanitizeString(req.params[paramName]);
    }
    next();
  };
}

/**
 * Middleware per sanitizzare il body della richiesta
 * @param {Array<string>} fieldNames - Nomi dei campi da sanitizzare
 * @returns {Function} - Middleware Express
 */
function sanitizeBody(fieldNames) {
  return (req, res, next) => {
    if (req.body) {
      fieldNames.forEach(field => {
        if (req.body[field]) {
          req.body[field] = sanitizeString(req.body[field]);
        }
      });
    }
    next();
  };
}

/**
 * Sanitizza l'HTML per prevenire XSS 
 * @param {string} html - HTML da sanitizzare
 * @returns {string} - HTML sanitizzato
 */
function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') {
    return '';
  }
  
  // Libreria DOMPurify non disponibile in Node.js nativo
  // Implementazione semplificata che rimuove gli script e le attribuzioni potenzialmente pericolose
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .replace(/data:/gi, '');
}

module.exports = {
  sanitizeString,
  validateQueryParam,
  validateParam,
  sanitizeQuery,
  sanitizeParam,
  sanitizeBody,
  sanitizeHtml
};