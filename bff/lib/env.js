function parseIntegerEnv(name, fallbackValue, options = {}) {
  const parsed = parseInt(process.env[name] || String(fallbackValue), 10);
  const fallback = Number(fallbackValue);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (Number.isFinite(options.min) && parsed < options.min) {
    return fallback;
  }

  if (Number.isFinite(options.max) && parsed > options.max) {
    return fallback;
  }

  return parsed;
}

function readConfiguredSecret(name, developmentFallback) {
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

module.exports = {
  parseIntegerEnv,
  readConfiguredSecret
};
