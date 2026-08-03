const { decode } = require('html-entities');
const { createError } = require('./errorHandler');
import type { RequestHandler } from 'express';

function sanitizeString(input: unknown) {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeHtml(input: unknown) {
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

function sanitizeQuery(paramNames: string | string[]): RequestHandler {
  const names = Array.isArray(paramNames) ? paramNames : [paramNames];

  return (req, res, next) => {
    names.forEach((paramName) => {
      if (req.query[paramName]) {
        req.query[paramName] = sanitizeString(req.query[paramName]);
      }
    });
    return next();
  };
}

function validateAndSanitizeParam(paramName: string, errorMessage = 'Parameter missing or invalid'): RequestHandler {
  return (req, res, next) => {
    if (!req.params[paramName]) {
      return next(createError(400, errorMessage, 'MISSING_PARAM'));
    }

    req.params[paramName] = sanitizeString(req.params[paramName]);
    return next();
  };
}

function sanitizeBody(fieldNames: string[] = []): RequestHandler {
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

export = {
  sanitizeHtml,
  sanitizeQuery,
  validateAndSanitizeParam,
  sanitizeBody
};
