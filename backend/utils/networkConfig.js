const DEFAULT_PROD_ORIGINS = ['http://localhost', 'http://localhost:80', 'http://frontend'];

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

  if (allowedOrigins.includes('*')) {
    return true;
  }

  return allowedOrigins.includes(origin);
}

module.exports = {
  getAllowedOrigins,
  isOriginAllowed
};
