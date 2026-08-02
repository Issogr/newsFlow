const crypto = require('crypto');

const DEFAULT_INTERNAL_PROXY_TOKEN = 'development-only-change-me';

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');

  if (leftBuffer.length === 0 || leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getConfiguredSecret(name, developmentFallback) {
  const configured = String(process.env[name] || '').trim();
  const isProduction = process.env.NODE_ENV === 'production';

  if (configured) {
    if (isProduction && configured === developmentFallback) {
      throw new Error(`${name} must not use the development default in production.`);
    }

    return configured;
  }

  if (isProduction) {
    throw new Error(`${name} is required in production.`);
  }

  return developmentFallback;
}

function getInternalProxyToken() {
  return getConfiguredSecret('INTERNAL_PROXY_TOKEN', DEFAULT_INTERNAL_PROXY_TOKEN);
}

function hasTrustedInternalService(headers = {}) {
  const actualToken = String(headers['x-newsflow-proxy'] || '').trim();
  return safeCompare(actualToken, getInternalProxyToken());
}

module.exports = {
  DEFAULT_INTERNAL_PROXY_TOKEN,
  getInternalProxyToken,
  hasTrustedInternalService,
};
