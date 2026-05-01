const crypto = require('crypto');
const cookie = require('cookie');
const cookieSignature = require('cookie-signature');
const { parseIntegerEnv, readConfiguredSecret } = require('./env');

const BACKEND_SESSION_COOKIE_NAME = 'newsflow_session';
const BFF_SESSION_COOKIE_NAME = 'newsflow_bff_session';
const SESSION_TTL_DAYS = parseIntegerEnv('SESSION_TTL_DAYS', 30, { min: 1 });
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const SESSION_SCHEMA_VERSION = 1;
const DEFAULT_BFF_SESSION_SECRET = 'development-only-change-me';
const DEFAULT_INTERNAL_PROXY_TOKEN = 'development-only-change-me';

function getBffSessionSecret() {
  return readConfiguredSecret('BFF_SESSION_SECRET', DEFAULT_BFF_SESSION_SECRET);
}

function getInternalProxyToken() {
  return readConfiguredSecret('INTERNAL_PROXY_TOKEN', DEFAULT_INTERNAL_PROXY_TOKEN);
}

function getSessionEncryptionKey() {
  return crypto.createHash('sha256').update(getBffSessionSecret()).digest();
}

function encryptBackendSessionCookie(value) {
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

function decryptBackendSessionCookie(value) {
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

function parseCookieHeader(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return {};
  }

  return cookie.parse(cookieHeader);
}

function serializeCookie(name, value, options = {}) {
  return cookie.serialize(name, value, options);
}

function getCookieSecureSetting() {
  if (process.env.COOKIE_SECURE === 'true') {
    return true;
  }

  if (process.env.COOKIE_SECURE === 'false') {
    return false;
  }

  const appBaseUrl = String(process.env.APP_BASE_URL || process.env.FRONTEND_BASE_URL || '').trim();
  if (appBaseUrl.startsWith('https://')) {
    return true;
  }

  return 'auto';
}

function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: getCookieSecureSetting(),
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
}

function getCookieClearOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  };
}

function clearBffSessionCookie(res) {
  res.append('Set-Cookie', serializeCookie(BFF_SESSION_COOKIE_NAME, '', getCookieClearOptions()));
}

function extractBackendSessionCookie(setCookieHeader) {
  const values = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : (setCookieHeader ? [setCookieHeader] : []);

  const rawCookie = values.find((entry) => String(entry || '').startsWith(`${BACKEND_SESSION_COOKIE_NAME}=`));

  if (!rawCookie) {
    return '';
  }

  return rawCookie.split(';')[0];
}

function isValidSessionPayload(sessionData) {
  if (!sessionData || typeof sessionData !== 'object') {
    return false;
  }

  const backendSessionCookie = decryptBackendSessionCookie(sessionData.backendSessionCookie || '');
  return sessionData.version === SESSION_SCHEMA_VERSION
    && backendSessionCookie.startsWith(`${BACKEND_SESSION_COOKIE_NAME}=`);
}

function unsignSessionId(rawCookieValue, secret) {
  const normalized = String(rawCookieValue || '').trim();

  if (!normalized) {
    return '';
  }

  const signedValue = normalized.startsWith('s:') ? normalized.slice(2) : normalized;
  const unsigned = cookieSignature.unsign(signedValue, secret);
  return unsigned === false ? '' : unsigned;
}

module.exports = {
  BACKEND_SESSION_COOKIE_NAME,
  BFF_SESSION_COOKIE_NAME,
  SESSION_SCHEMA_VERSION,
  clearBffSessionCookie,
  decryptBackendSessionCookie,
  encryptBackendSessionCookie,
  extractBackendSessionCookie,
  getBffSessionSecret,
  getInternalProxyToken,
  getSessionCookieOptions,
  isValidSessionPayload,
  parseCookieHeader,
  serializeCookie,
  unsignSessionId
};
