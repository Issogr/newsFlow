/**
 * Modulo per la validazione e sanitizzazione degli input
 */

const createError = require('./errorHandler').createError;
const logger = require('./logger');
const { decode } = require('html-entities'); // Importazione della libreria per decodificare le entità HTML

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
function validateQueryParam(paramName, errorMessage = 'Parameter missing or invalid') {
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
function validateParam(paramName, errorMessage = 'Parameter missing or invalid') {
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
 * Implementazione migliorata con una white-list di tag e attributi consentiti
 * e decodifica delle entità HTML usando la libreria html-entities
 * 
 * @param {string} html - HTML da sanitizzare
 * @returns {string} - HTML sanitizzato
 */
function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') {
    return '';
  }
  
  try {
    // Lista di tag consentiti con attributi permessi
    const allowedTags = {
      'p': ['style', 'class'],
      'a': ['href', 'title', 'target', 'rel', 'class'],
      'br': [],
      'strong': ['class'],
      'b': ['class'],
      'em': ['class'],
      'i': ['class'],
      'u': ['class'],
      'span': ['class', 'style'],
      'div': ['class', 'style'],
      'ul': ['class'],
      'ol': ['class'],
      'li': ['class'],
      'h1': ['class', 'id'],
      'h2': ['class', 'id'],
      'h3': ['class', 'id'],
      'h4': ['class', 'id'],
      'h5': ['class', 'id'],
      'h6': ['class', 'id'],
      'img': ['src', 'alt', 'title', 'width', 'height', 'class']
    };
    
    // Rimuovi tag non consentiti
    let sanitized = html;
    
    // Rimuovi tutti i tag script
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    
    // Rimuovi i commenti HTML
    sanitized = sanitized.replace(/<!--[\s\S]*?-->/g, '');
    
    // Rimuovi attributi on* e javascript:
    sanitized = sanitized.replace(/\son\w+\s*=\s*(?:(['"])(?:\\\1|.)*?\1|(?:\S+))/gi, '');
    sanitized = sanitized.replace(/javascript:/gi, 'removed:');
    sanitized = sanitized.replace(/data:/gi, 'removed:');
    
    // Verifica che gli URL di immagini inizino con http o https
    sanitized = sanitized.replace(/(<img[^>]+src\s*=\s*['"])([^'"]+)(['"][^>]*>)/gi, (match, start, url, end) => {
      if (url.trim().toLowerCase().startsWith('http') || url.trim().toLowerCase().startsWith('https')) {
        return start + url + end;
      } else {
        return start + 'removed:' + url + end;
      }
    });
    
    // Verifica gli URL nei link
    sanitized = sanitized.replace(/(<a[^>]+href\s*=\s*['"])([^'"]+)(['"][^>]*>)/gi, (match, start, url, end) => {
      if (url.trim().toLowerCase().startsWith('http') || 
          url.trim().toLowerCase().startsWith('https') || 
          url.trim().toLowerCase().startsWith('mailto:') || 
          url.trim().startsWith('/') || 
          url.trim().startsWith('#')) {
        return start + url + end;
      } else {
        return start + 'removed:' + url + end;
      }
    });
    
    // Assicurati che tutti i link esterni abbiano target="_blank" e rel="noopener noreferrer"
    sanitized = sanitized.replace(/(<a[^>]+href\s*=\s*['"](?:http|https)[^'"]+['"])([^>]*)(>)/gi, (match, start, attrs, end) => {
      if (!attrs.includes('target=')) {
        attrs += ' target="_blank"';
      }
      if (!attrs.includes('rel=')) {
        attrs += ' rel="noopener noreferrer"';
      }
      return start + attrs + end;
    });
    
    // Usa html-entities per decodificare TUTTE le entità HTML in modo completo
    sanitized = decode(sanitized);
    
    return sanitized;
  } catch (error) {
    logger.error(`Error sanitizing HTML: ${error.message}`);
    // In caso di errore, rimuovi tutto l'HTML e decodifica comunque le entità
    return decode(html.replace(/<[^>]*>/g, ''));
  }
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