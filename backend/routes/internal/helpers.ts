const newsService = require('../../services/newsAggregator');
const userService = require('../../services/userService');
const { isAuthenticatedPublicApiEnabled } = require('../../config/publicApi');
const { extractSessionCookie } = require('../../utils/auth');
const { createError } = require('../../utils/errorHandler');
const { buildUserContext } = require('../../utils/userContext');
const { clearSessionCookie, setSessionCookie } = require('../../utils/sessionCookie');
const logger = require('../../utils/logger');
import type { NextFunction, Request, Response } from 'express';
import type { UnknownRecord } from '../../utils/types';

function refreshUserSourcesInBackground(userId: string, options: UnknownRecord = {}, label = 'user sources') {
  newsService.refreshUserSources(userId, options).catch((error: unknown) => {
    logger.warn(`Background refresh failed for ${label}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

function refreshUserSourceInBackground(userId: string, sourceId: string) {
  refreshUserSourcesInBackground(userId, { sourceIds: [sourceId], broadcast: true }, `custom source ${sourceId}`);
}

function getRequestAbortSignal(req: Request, res: Response) {
  const controller = new globalThis.AbortController();
  const abort = () => controller.abort();
  req.once('aborted', abort);
  res.once('close', () => {
    req.removeListener('aborted', abort);
    if (!res.writableEnded) {
      abort();
    }
  });
  return controller.signal;
}

function sendAuthResult(req: Request, res: Response, result: { token: string; [key: string]: unknown }, status = 200) {
  const previousSessionToken = extractSessionCookie(req.headers.cookie);
  if (previousSessionToken && previousSessionToken !== result.token) {
    userService.logoutUser(previousSessionToken);
  }
  setSessionCookie(req, res, result.token);
  const { token, ...safeResult } = result;
  res.status(status).json(safeResult);
}

function getUserContext(req: Request) {
  const settings = userService.getUserSettings(req.user.id);
  return buildUserContext(req.user.id, settings);
}

function getRequestIds(req: Request, pluralKey: string, singularKey: string) {
  const rawIds = Array.isArray(req.body?.[pluralKey])
    ? req.body[pluralKey]
    : [req.body?.[singularKey]];

  return rawIds.map((id) => String(id || '').trim()).filter(Boolean);
}

function requireAuthenticatedPublicApiFeature(req: Request, res: Response, next: NextFunction) {
  if (isAuthenticatedPublicApiEnabled()) {
    next();
    return;
  }

  next(createError(404, 'Public API token access is disabled.', 'PUBLIC_API_DISABLED'));
}

export = {
  clearSessionCookie,
  getRequestAbortSignal,
  getRequestIds,
  getUserContext,
  refreshUserSourceInBackground,
  refreshUserSourcesInBackground,
  requireAuthenticatedPublicApiFeature,
  sendAuthResult,
};
