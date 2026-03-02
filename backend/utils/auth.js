const crypto = require('crypto');
const { createError } = require('./errorHandler');

function extractBearerToken(authorizationHeader) {
  if (!authorizationHeader || typeof authorizationHeader !== 'string') {
    return '';
  }

  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return '';
  }

  return token.trim();
}

function safeTokenCompare(expectedToken, receivedToken) {
  if (!expectedToken || !receivedToken) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedToken);
  const receivedBuffer = Buffer.from(receivedToken);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function requireAdminToken(req, res, next) {
  const configuredToken = process.env.ADMIN_API_TOKEN || process.env.API_ADMIN_TOKEN || '';

  if (!configuredToken) {
    return next(createError(
      503,
      'Token amministrativo non configurato sul server',
      'ADMIN_TOKEN_NOT_CONFIGURED'
    ));
  }

  const headers = req.headers || {};
  const tokenFromHeader = headers['x-admin-token'];
  const tokenFromBearer = extractBearerToken(headers.authorization);
  const providedToken = tokenFromBearer || tokenFromHeader || '';

  if (!safeTokenCompare(configuredToken, providedToken)) {
    return next(createError(
      401,
      'Token amministrativo non valido',
      'UNAUTHORIZED'
    ));
  }

  return next();
}

module.exports = {
  requireAdminToken,
  extractBearerToken,
  safeTokenCompare
};
