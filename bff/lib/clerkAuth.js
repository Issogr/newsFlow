const crypto = require('crypto');

const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;
const jwksCache = new Map();

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64');
}

function parseJwtJson(segment) {
  try {
    return JSON.parse(base64UrlDecode(segment).toString('utf8'));
  } catch {
    return null;
  }
}

function getClerkIssuerUrl() {
  return String(process.env.CLERK_ISSUER_URL || '').trim().replace(/\/+$/, '');
}

function getClerkJwksUrl() {
  const configuredUrl = String(process.env.CLERK_JWKS_URL || '').trim();
  if (configuredUrl) {
    return configuredUrl;
  }

  const issuerUrl = getClerkIssuerUrl();
  return issuerUrl ? `${issuerUrl}/.well-known/jwks.json` : '';
}

function getAllowedAudiences() {
  return String(process.env.CLERK_AUDIENCE || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function fetchJwks(jwksUrl) {
  const cached = jwksCache.get(jwksUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.keys;
  }

  const response = await fetch(jwksUrl, {
    headers: { accept: 'application/json' }
  });
  if (!response.ok) {
    throw new Error('Unable to fetch Clerk signing keys');
  }

  const payload = await response.json();
  const keys = Array.isArray(payload.keys) ? payload.keys : [];
  jwksCache.set(jwksUrl, {
    keys,
    expiresAt: Date.now() + JWKS_CACHE_TTL_MS
  });
  return keys;
}

function hasAllowedAudience(payload, allowedAudiences) {
  if (allowedAudiences.length === 0) {
    return true;
  }

  const tokenAudiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud].filter(Boolean);
  return tokenAudiences.some((audience) => allowedAudiences.includes(String(audience || '')));
}

function verifyJwtSignature({ header, token, jwk }) {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  return header.alg === 'RS256' && verifier.verify(publicKey, base64UrlDecode(encodedSignature));
}

async function verifyClerkSessionToken(token) {
  const normalizedToken = String(token || '').trim();
  const parts = normalizedToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid Clerk token');
  }

  const issuerUrl = getClerkIssuerUrl();
  const jwksUrl = getClerkJwksUrl();
  if (!issuerUrl || !jwksUrl) {
    throw new Error('Clerk auth is not configured');
  }

  const header = parseJwtJson(parts[0]);
  const payload = parseJwtJson(parts[1]);
  if (!header || !payload || header.typ !== 'JWT' || !header.kid) {
    throw new Error('Invalid Clerk token');
  }

  const keys = await fetchJwks(jwksUrl);
  const jwk = keys.find((key) => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk || !verifyJwtSignature({ header, token: normalizedToken, jwk })) {
    throw new Error('Invalid Clerk token signature');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.iss !== issuerUrl) {
    throw new Error('Invalid Clerk token issuer');
  }
  if (Number(payload.exp || 0) <= nowSeconds - CLOCK_SKEW_SECONDS) {
    throw new Error('Clerk token expired');
  }
  if (payload.nbf && Number(payload.nbf) > nowSeconds + CLOCK_SKEW_SECONDS) {
    throw new Error('Clerk token is not active yet');
  }
  if (!hasAllowedAudience(payload, getAllowedAudiences())) {
    throw new Error('Invalid Clerk token audience');
  }

  return payload;
}

function getPrimaryEmail(payload = {}) {
  const email = payload.email || payload.email_address || payload.primary_email_address;
  if (email) {
    return String(email).trim().toLowerCase();
  }

  const emailAddresses = Array.isArray(payload.email_addresses) ? payload.email_addresses : [];
  const primaryId = payload.primary_email_address_id;
  const primary = emailAddresses.find((item) => item.id === primaryId) || emailAddresses[0];
  return String(primary?.email_address || '').trim().toLowerCase();
}

function mapClerkPayloadToIdentity(payload = {}) {
  return {
    provider: 'clerk',
    providerUserId: String(payload.sub || '').trim(),
    email: getPrimaryEmail(payload),
    username: String(payload.username || '').trim(),
    name: String(payload.name || payload.full_name || '').trim()
  };
}

module.exports = {
  mapClerkPayloadToIdentity,
  verifyClerkSessionToken
};
