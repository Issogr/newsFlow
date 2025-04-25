/**
 * Modulo per la validazione e sanitizzazione degli input
 * [MIGLIORATO] Con sanitizzazione HTML robusta contro attacchi XSS
 */

const createError = require('./errorHandler').createError;
const logger = require('./logger');
const { decode } = require('html-entities'); // Importazione della libreria per decodificare le entità HTML

// [NUOVO] Aggiunte necessarie per DOMPurify
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

// [NUOVO] Creiamo l'istanza DOMPurify una sola volta
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// [NUOVO] Configurazione sicura di DOMPurify
const ALLOWED_TAGS = [
  'p', 'a', 'br', 'strong', 'b', 'em', 'i', 'u', 'span', 'div', 
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img'
];

const ALLOWED_ATTR = [
  'href', 'target', 'rel', 'src', 'alt', 'title', 'class', 'style'
];

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
 * [MIGLIORATO] Sanitizza l'HTML per prevenire XSS
 * Utilizza DOMPurify per una sanitizzazione robusta contro attacchi XSS
 * 
 * @param {string} html - HTML da sanitizzare
 * @returns {string} - HTML sanitizzato
 */
function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') {
    return '';
  }
  
  try {
    // Sanitizza l'HTML con DOMPurify
    const sanitizedHtml = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ALLOWED_TAGS,
      ALLOWED_ATTR: ALLOWED_ATTR,
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'meta'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
      ALLOW_DATA_ATTR: false,
      USE_PROFILES: { html: true },
      ADD_URI_SAFE_ATTR: ['target']
    });
    
    // Modifica gli URL nelle immagini per assicurarsi che inizino con http o https
    const parser = new window.DOMParser();
    const doc = parser.parseFromString(sanitizedHtml, 'text/html');
    
    // Sanitizza gli attributi src delle immagini
    const images = doc.querySelectorAll('img');
    images.forEach(img => {
      const src = img.getAttribute('src');
      if (src && !(src.toLowerCase().startsWith('http://') || src.toLowerCase().startsWith('https://'))) {
        img.setAttribute('src', 'removed:' + src);
      }
    });
    
    // Sanitizza gli attributi href dei link
    const links = doc.querySelectorAll('a');
    links.forEach(link => {
      const href = link.getAttribute('href');
      if (href) {
        // Permetti solo link http, https, mailto, o relativi
        if (!(href.toLowerCase().startsWith('http://') || 
              href.toLowerCase().startsWith('https://') || 
              href.toLowerCase().startsWith('mailto:') || 
              href.startsWith('/') || 
              href.startsWith('#'))) {
          link.setAttribute('href', 'removed:' + href);
        }
        
        // Assicurati che tutti i link esterni abbiano target="_blank" e rel="noopener noreferrer"
        if (href.toLowerCase().startsWith('http://') || href.toLowerCase().startsWith('https://')) {
          link.setAttribute('target', '_blank');
          link.setAttribute('rel', 'noopener noreferrer');
        }
      }
    });
    
    // Usa html-entities per decodificare le entità HTML in modo completo
    return decode(doc.body.innerHTML);
  } catch (error) {
    logger.error(`Error sanitizing HTML: ${error.message}`);
    
    // Fallback in caso di errore: rimuovi tutto l'HTML
    try {
      return decode(DOMPurify.sanitize(html, { ALLOWED_TAGS: [] }));
    } catch (fallbackError) {
      logger.error(`Fallback sanitization failed: ${fallbackError.message}`);
      return decode(html.replace(/<[^>]*>/g, ''));
    }
  }
}

/**
 * [NUOVO] Sanitizza un oggetto contentente HTML in modo ricorsivo
 * Utile per sanitizzare oggetti JSON complessi che contengono HTML
 * 
 * @param {Object|Array|string} data - Oggetto o array da sanitizzare
 * @returns {Object|Array|string} - Oggetto o array sanitizzato
 */
function sanitizeDeep(data) {
  if (typeof data !== 'object' || data === null) {
    return typeof data === 'string' ? sanitizeString(data) : data;
  }
  
  if (Array.isArray(data)) {
    return data.map(item => sanitizeDeep(item));
  }
  
  const result = {};
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      result[key] = sanitizeDeep(data[key]);
    }
  }
  
  return result;
}

/**
 * [NUOVO] Verifica se un input contiene pattern di attacco XSS
 * Utile per segnalare potenziali tentativi di attacco
 * 
 * @param {string} input - Input da verificare
 * @returns {boolean} - true se l'input contiene pattern sospetti
 */
function containsXSSPatterns(input) {
  if (typeof input !== 'string') return false;
  
  const suspiciousPatterns = [
    /<script.*?>.*?<\/script>/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /data:(?!image)/i,
    /<iframe.*?>.*?<\/iframe>/i,
    /<svg.*?>.*?<\/svg>/i,
    /document\.cookie/i,
    /document\.location/i,
    /eval\(/i,
    /localStorage/i,
    /sessionStorage/i
  ];
  
  return suspiciousPatterns.some(pattern => pattern.test(input));
}

module.exports = {
  sanitizeString,
  validateQueryParam,
  validateParam,
  sanitizeQuery,
  sanitizeParam,
  sanitizeBody,
  sanitizeHtml,
  // [NUOVO] Esporta le nuove funzioni
  sanitizeDeep,
  containsXSSPatterns
};