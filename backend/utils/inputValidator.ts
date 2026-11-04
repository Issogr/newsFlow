import { decode } from 'html-entities';
import { createError } from './errorHandler';
import type { RequestHandler } from 'express';

function sanitizeString(input: unknown) {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    .replace(/<[^<>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeHtml(input: unknown) {
  if (typeof input !== 'string') {
    return '';
  }

  const parts: string[] = [];
  let cursor = 0;
  let ignoredTag = '';
  for (const match of input.matchAll(/<(\/?)(script|style)\b[^<>]*>/gi)) {
    const tag = match[2].toLowerCase();
    if (!ignoredTag) {
      parts.push(input.slice(cursor, match.index), ' ');
      if (!match[1]) ignoredTag = tag;
    } else if (match[1] && tag === ignoredTag) {
      ignoredTag = '';
    }
    cursor = match.index + match[0].length;
  }
  if (!ignoredTag) parts.push(input.slice(cursor));
  const withoutScripts = parts.join('').replace(/<[^<>]*>/g, ' ');

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
  if (typeof username !== 'string' || username.length > 256) {
    throw createError(400, 'Username must be a string of at most 256 characters', 'INVALID_USERNAME');
  }
  return sanitizeString(username).slice(0, 40);
}

export default {
  sanitizeHtml,
  validateAndSanitizeParam,
  sanitizeUsername
};
