import { decode } from 'html-entities';
import { createError } from './errorHandler';
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

function validateAndSanitizeParam(paramName: string, errorMessage = 'Parameter missing or invalid'): RequestHandler {
  return (req, res, next) => {
    if (!req.params[paramName]) {
      return next(createError(400, errorMessage, 'MISSING_PARAM'));
    }

    req.params[paramName] = sanitizeString(req.params[paramName]);
    return next();
  };
}

function sanitizeUsername(username: unknown) {
  return sanitizeString(String(username || '')).slice(0, 40);
}

export default {
  sanitizeHtml,
  validateAndSanitizeParam,
  sanitizeUsername
};
