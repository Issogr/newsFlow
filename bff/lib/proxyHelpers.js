const BLOCKED_BACKEND_RESPONSE_HEADERS = new Set([
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

function getRequestHeader(req, name) {
  const value = typeof req.get === 'function'
    ? req.get(name)
    : req.headers?.[String(name || '').toLowerCase()];

  return Array.isArray(value) ? value[0] : value;
}

function buildTrustedForwardedHeaders(req, options = {}) {
  const forwardedFor = String(req.ip || req.socket?.remoteAddress || '').trim();
  const forwardedProto = req.protocol || (req.socket?.encrypted ? 'https' : 'http');
  const forwardedHost = String(getRequestHeader(req, 'host') || '').trim();
  const headers = {};

  if (forwardedFor || options.includeEmpty) {
    headers['x-forwarded-for'] = forwardedFor;
  }

  if (forwardedHost || options.includeEmpty) {
    headers['x-forwarded-host'] = forwardedHost;
  }

  headers['x-forwarded-proto'] = forwardedProto;

  return headers;
}

function applyProxyRequestHeaders(proxyReq, req, options = {}) {
  proxyReq.removeHeader('x-forwarded-for');
  proxyReq.removeHeader('x-forwarded-host');
  proxyReq.removeHeader('x-forwarded-proto');

  if (options.mode === 'private') {
    proxyReq.removeHeader('authorization');
    proxyReq.removeHeader('origin');
    proxyReq.removeHeader('x-session-token');
    proxyReq.removeHeader('x-newsflow-app');
    Object.entries(options.internalHeaders || {}).forEach(([name, value]) => {
      proxyReq.setHeader(name, value);
    });

    if (options.backendSessionCookie) {
      proxyReq.setHeader('cookie', options.backendSessionCookie);
    } else {
      proxyReq.removeHeader('cookie');
    }
    return;
  }

  proxyReq.removeHeader('cookie');
  Object.entries(buildTrustedForwardedHeaders(req)).forEach(([name, value]) => {
    proxyReq.setHeader(name, value);
  });
}

function copyBackendResponseHeaders(res, headers = {}) {
  Object.entries(headers).forEach(([name, value]) => {
    const lowerName = String(name || '').toLowerCase();

    if (BLOCKED_BACKEND_RESPONSE_HEADERS.has(lowerName) || lowerName.startsWith('access-control-')) {
      return;
    }

    if (value !== undefined) {
      res.setHeader(name, value);
    }
  });
}

function stripBackendCorsResponseHeaders(headers = {}) {
  Object.keys(headers).forEach((name) => {
    if (String(name).toLowerCase().startsWith('access-control-')) {
      delete headers[name];
    }
  });
}

function extractDeletedAdminUserId(req, statusCode) {
  if (String(req.method || '').toUpperCase() !== 'DELETE' || statusCode < 200 || statusCode >= 300) {
    return '';
  }

  const rawPath = String(req.originalUrl || req.url || '');
  const match = rawPath.match(/^\/api\/admin\/users\/([^/?#]+)\/?(?:[?#].*)?$/);
  return match?.[1] || '';
}

module.exports = {
  applyProxyRequestHeaders,
  buildTrustedForwardedHeaders,
  copyBackendResponseHeaders,
  extractDeletedAdminUserId,
  getRequestHeader,
  stripBackendCorsResponseHeaders
};
