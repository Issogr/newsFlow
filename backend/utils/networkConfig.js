const DEFAULT_PROD_ORIGINS = ['http://localhost', 'http://localhost:80', 'http://127.0.0.1', 'http://127.0.0.1:80', 'http://frontend', '@local-network'];

function isPrivateIpv4Hostname(hostname) {
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = String(hostname || '').match(ipv4Pattern);

  if (!match) {
    return false;
  }

  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) {
    return false;
  }

  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
}

function isLocalNetworkOrigin(origin) {
  try {
    const parsedOrigin = new URL(origin);
    const hostname = parsedOrigin.hostname.toLowerCase();

    return hostname === 'localhost'
      || hostname === 'frontend'
      || hostname === '::1'
      || hostname.endsWith('.local')
      || isPrivateIpv4Hostname(hostname);
  } catch {
    return false;
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesAllowedOrigin(origin, allowedOrigin) {
  if (allowedOrigin === '*') {
    return true;
  }

  if (allowedOrigin === '@local-network') {
    return isLocalNetworkOrigin(origin);
  }

  if (allowedOrigin.includes('*')) {
    const pattern = new RegExp(`^${escapeRegex(allowedOrigin).replace(/\\\*/g, '.*')}$`);
    return pattern.test(origin);
  }

  return allowedOrigin === origin;
}

function getAllowedOrigins() {
  const rawOrigins = process.env.ALLOWED_ORIGINS || '';
  const parsedOrigins = rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (parsedOrigins.length > 0) {
    return parsedOrigins;
  }

  if (process.env.NODE_ENV === 'production') {
    return DEFAULT_PROD_ORIGINS;
  }

  return ['*'];
}

function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) {
    return true;
  }

  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    return false;
  }

  return allowedOrigins.some((allowedOrigin) => matchesAllowedOrigin(origin, allowedOrigin));
}

module.exports = {
  getAllowedOrigins,
  isOriginAllowed
};
