const { decode } = require('html-entities');

function sanitizeString(input) {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeHtml(input) {
  if (typeof input !== 'string') {
    return '';
  }

  const withoutScripts = input
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');

  return decode(withoutScripts)
    .replace(/\s+/g, ' ')
    .trim();
}

function validateParam(paramName, errorMessage = 'Parameter missing or invalid') {
  return (req, res, next) => {
    if (!req.params[paramName]) {
      return next(createError(400, errorMessage, 'MISSING_PARAM'));
    }
    return next();
  };
}

function sanitizeQuery(paramName) {
  return (req, res, next) => {
    if (req.query[paramName]) {
      req.query[paramName] = sanitizeString(req.query[paramName]);
    }
    return next();
  };
}

function sanitizeParam(paramName) {
  return (req, res, next) => {
    if (req.params[paramName]) {
      req.params[paramName] = sanitizeString(req.params[paramName]);
    }
    return next();
  };
}

function sanitizeBody(fieldNames = []) {
  return (req, res, next) => {
    if (!req.body || !Array.isArray(fieldNames)) {
      return next();
    }

    fieldNames.forEach((fieldName) => {
      if (typeof req.body[fieldName] === 'string') {
        req.body[fieldName] = sanitizeString(req.body[fieldName]);
      }
    });

    return next();
  };
}

module.exports = {
  sanitizeString,
  sanitizeHtml,
  validateParam,
  sanitizeQuery,
  sanitizeParam,
  sanitizeBody
};
