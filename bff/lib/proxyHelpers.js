const path = require('path');

function applySanitizedForwardedHeaders(proxyReq, req) {
  proxyReq.removeHeader('x-forwarded-for');
  proxyReq.removeHeader('x-forwarded-host');
  proxyReq.removeHeader('x-forwarded-proto');

  const clientIp = req.ip || req.socket?.remoteAddress;
  if (clientIp) {
    proxyReq.setHeader('X-Forwarded-For', clientIp);
  }

  if (req.headers.host) {
    proxyReq.setHeader('X-Forwarded-Host', req.headers.host);
  }

  proxyReq.setHeader('X-Forwarded-Proto', req.protocol || (req.socket?.encrypted ? 'https' : 'http'));
}

function copyBackendResponseHeaders(res, headers = {}) {
  const blockedHeaders = new Set([
    'connection',
    'content-length',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'set-cookie',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ]);

  Object.entries(headers).forEach(([name, value]) => {
    const lowerName = String(name || '').toLowerCase();

    if (blockedHeaders.has(lowerName)) {
      return;
    }

    if (value !== undefined) {
      res.setHeader(name, value);
    }
  });
}

function serveSpaIndex(frontendDistDir, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(frontendDistDir, 'index.html'));
}

function extractDeletedAdminUserId(req, statusCode) {
  if (String(req.method || '').toUpperCase() !== 'DELETE' || statusCode < 200 || statusCode >= 300) {
    return '';
  }

  const rawPath = String(req.originalUrl || req.url || '');
  const match = rawPath.match(/^\/api\/admin\/users\/([^/?#]+)$/);
  return match?.[1] || '';
}

module.exports = {
  applySanitizedForwardedHeaders,
  copyBackendResponseHeaders,
  extractDeletedAdminUserId,
  serveSpaIndex
};
