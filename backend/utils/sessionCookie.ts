const { parseIntegerEnv } = require('./env');
import type { CookieOptions, Request, Response } from 'express';

const SESSION_COOKIE_NAME = 'newsflow_session';

function getSessionCookieOptions(req?: Request): CookieOptions {
  const value = String(process.env.COOKIE_SECURE || 'auto').trim().toLowerCase();
  if (!['auto', 'true', 'false'].includes(value) && process.env.NODE_ENV === 'production') {
    throw new Error('COOKIE_SECURE must be one of: auto, true, false.');
  }

  const appBaseUrl = String(process.env.APP_BASE_URL || process.env.FRONTEND_BASE_URL || '').trim();
  const secure = value === 'true'
    || (value !== 'false' && (appBaseUrl.startsWith('https://') || req?.secure === true));

  return {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: '/',
    maxAge: parseIntegerEnv('SESSION_TTL_DAYS', 30, { min: 1 }) * 24 * 60 * 60 * 1000,
  };
}

function setSessionCookie(req: Request, res: Response, sessionToken: string): void {
  res.cookie(SESSION_COOKIE_NAME, sessionToken, getSessionCookieOptions(req));
}

function clearSessionCookie(req: Request, res: Response): void {
  const { maxAge, ...options } = getSessionCookieOptions(req);
  res.clearCookie(SESSION_COOKIE_NAME, options);
}

export = {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  getSessionCookieOptions,
  setSessionCookie,
};
