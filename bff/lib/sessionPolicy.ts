import crypto = require('node:crypto');
import cookie = require('cookie');
import cookieSignature = require('cookie-signature');
import type { Response } from 'express';
import type session = require('express-session');
import { parseIntegerEnv, readConfiguredSecret } from './env';

const BACKEND_SESSION_COOKIE_NAME = 'newsflow_session';
export const BFF_SESSION_COOKIE_NAME = 'newsflow_bff_session';
const SESSION_TTL_DAYS = parseIntegerEnv('SESSION_TTL_DAYS', 30, { min: 1 });
export const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
export const SESSION_SCHEMA_VERSION = 1;
const DEFAULT_BFF_SESSION_SECRET = 'development-only-change-me';
const DEFAULT_INTERNAL_PROXY_TOKEN = 'development-only-change-me';

export function getBffSessionSecret(): string {
  return readConfiguredSecret('BFF_SESSION_SECRET', DEFAULT_BFF_SESSION_SECRET);
}

export function getInternalProxyToken(): string {
  return readConfiguredSecret('INTERNAL_PROXY_TOKEN', DEFAULT_INTERNAL_PROXY_TOKEN);
}

function getSessionEncryptionKey(): Buffer {
  return crypto.createHash('sha256').update(getBffSessionSecret()).digest();
}

export function encryptBackendSessionCookie(value: string): string {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return '';
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getSessionEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(rawValue, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    'enc',
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decryptBackendSessionCookie(value: string): string {
  const storedValue = String(value || '').trim();
  if (!storedValue || !storedValue.startsWith('enc:v1:')) {
    return '';
  }

  const [, , ivValue, tagValue, encryptedValue] = storedValue.split(':');
  if (!ivValue || !tagValue || !encryptedValue) {
    return '';
  }

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getSessionEncryptionKey(), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
}

function getCookieSecureSetting(): boolean | 'auto' {
  const cookieSecureValue = String(process.env.COOKIE_SECURE || 'auto').trim().toLowerCase();

  if (cookieSecureValue === 'true') {
    return true;
  }

  if (cookieSecureValue === 'false') {
    return false;
  }

  if (cookieSecureValue !== 'auto' && process.env.NODE_ENV === 'production') {
    throw new Error('COOKIE_SECURE must be one of: auto, true, false.');
  }

  const appBaseUrl = String(process.env.APP_BASE_URL || process.env.FRONTEND_BASE_URL || '').trim();
  if (appBaseUrl.startsWith('https://')) {
    return true;
  }

  return 'auto';
}

function getBaseSessionCookieOptions(): cookie.SerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
  };
}

export function getSessionCookieOptions(): session.CookieOptions {
  return {
    ...getBaseSessionCookieOptions(),
    secure: getCookieSecureSetting(),
    maxAge: SESSION_TTL_MS,
  };
}

export function clearBffSessionCookie(res: Response): void {
  res.append('Set-Cookie', cookie.serialize(BFF_SESSION_COOKIE_NAME, '', {
    ...getBaseSessionCookieOptions(),
    maxAge: 0,
  }));
}

export function extractBackendSessionCookie(setCookieHeader: string | string[] | undefined): string {
  const values = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : (setCookieHeader ? [setCookieHeader] : []);

  const rawCookie = values.find((entry) => String(entry || '').startsWith(`${BACKEND_SESSION_COOKIE_NAME}=`));

  if (!rawCookie) {
    return '';
  }

  return rawCookie.split(';')[0];
}

export function isValidSessionPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const sessionData = value as { version?: unknown; backendSessionCookie?: unknown };
  const backendSessionCookie = decryptBackendSessionCookie(
    typeof sessionData.backendSessionCookie === 'string' ? sessionData.backendSessionCookie : '',
  );
  return sessionData.version === SESSION_SCHEMA_VERSION
    && backendSessionCookie.startsWith(`${BACKEND_SESSION_COOKIE_NAME}=`);
}

export function unsignSessionId(rawCookieValue: string | undefined, secret: string): string {
  const normalized = String(rawCookieValue || '').trim();

  if (!normalized) {
    return '';
  }

  const signedValue = normalized.startsWith('s:') ? normalized.slice(2) : normalized;
  const unsigned = cookieSignature.unsign(signedValue, secret);
  return unsigned === false ? '' : unsigned;
}
